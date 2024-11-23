package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robfig/cron/v3"
)

var (
	flagFetchChannels    bool // Fetch channels from EPG providers.
	flagSendXMLTV2Socket bool // Send XMLTV file to Unix domain socket.
	flagDeamonize        bool // Run as daemon.

	// Select channels from epg2xml_conf/Channel.json by EPG provider and category.
	// {EPGProvider1}:{Category1,Category2};{EPGProvider2}:{Category1};...
	flagEPGProvidersCategories string // "NAVER:지상파"

	// Select channels from epg2xml_conf/Channel.json by channel name.
	// {ChannelName1},{ChannelName2},...
	flagNameFilter string // "경인 KBS1,KBS2,MBC,SBS,EBS1,EBS2"
)

func main() {
	flag.BoolVar(&flagFetchChannels, "fc", false, "Fetch channels from EPG providers.")
	flag.BoolVar(&flagSendXMLTV2Socket, "ss", false, "Send XMLTV file to Unix domain socket.")
	flag.BoolVar(&flagDeamonize, "d", false, "Run as daemon.")
	flag.StringVar(&flagEPGProvidersCategories, "pc", "NAVER:지상파", "Select channels from epg2xml_conf/Channel.json by EPG provider and category.")
	flag.StringVar(&flagNameFilter, "nf", "KBS1,KBS2,MBC,SBS,EBS1,EBS2", "Select channels from epg2xml_conf/Channel.json by channel name.")
	flag.Parse()

	chNameFilter := setChannelNameFilter(flagNameFilter)

	log.Println("Listing up channel candidates...")
	channels, err := EPG2XMLSearchChannels(flagFetchChannels)
	if err != nil {
		log.Fatal(err)
	}

	epgProviderCategoryChannels := make(map[string]map[string][]*Channel)
	for ep, sr := range channels {
		for _, ch := range sr.Channels {
			if _, ok := epgProviderCategoryChannels[ep]; !ok {
				epgProviderCategoryChannels[ep] = make(map[string][]*Channel)
			}

			ch.epgProvider = ep
			epgProviderCategoryChannels[ep][ch.Category] = append(epgProviderCategoryChannels[ep][ch.Category], ch)
		}
	}

	log.Println("Selecting channels by given EPG providers, categories and, name filters...")
	var selectedChannels []*Channel
	pcs := strings.Split(flagEPGProvidersCategories, ";")
	for _, pc := range pcs {
		parts := strings.Split(pc, ":")
		provider := parts[0]
		categorySelects := strings.Split(parts[1], ",")
		for _, category := range categorySelects {
			chs := epgProviderCategoryChannels[provider][category]
			if chNameFilter == nil {
				selectedChannels = append(selectedChannels, chs...)
			} else {
				for _, ch := range chs {
					if _, ok := chNameFilter[ch.Name]; ok {
						selectedChannels = append(selectedChannels, ch)
					}
				}
			}
		}
	}

	log.Println("Making XMLTV file...")
	if err := EPG2XMLMakeXMLTV(selectedChannels); err != nil {
		log.Fatal(err)
	}

	if flagSendXMLTV2Socket {
		log.Println("Sending XMLTV file to Unix domain socket...")
		tryCount, waitDur := 6, 10*time.Second
		for i := 0; i < tryCount; i++ {
			if err := sendXMLTV2Socket(); err != nil {
				log.Printf("Fail to send XMLTV file to Unix domain socket: %v", err)
				time.Sleep(waitDur)
				continue
			} else {
				break
			}
		}
	}

	if flagDeamonize {
		c := cron.New()
		_, err := c.AddFunc(cronChannelFetch, func() {
			log.Println("Fetching channels...")
			if _, err := EPG2XMLSearchChannels(true); err != nil {
				log.Printf("Fail to fetch channels: %v", err)
			}
		})
		if err != nil {
			log.Fatal(err)
		}
		_, err = c.AddFunc(cronGenerateXMLTV, func() {
			log.Println("Generating XMLTV file...")
			if err := EPG2XMLMakeXMLTV(selectedChannels); err != nil {
				log.Printf("Fail to generate XMLTV file: %v", err)
			}
			if flagSendXMLTV2Socket {
				log.Println("Sending XMLTV file to Unix domain socket...")
				if err := sendXMLTV2Socket(); err != nil {
					log.Printf("Fail to send XMLTV file to Unix domain socket: %v", err)
				}
			}
		})
		if err != nil {
			log.Fatal(err)
		}
		c.Start()
		log.Println("Running as daemon...")
		select {}
	}

	log.Println("Done.")
}

func sendXMLTV2Socket() error {
	conn, err := net.Dial("unix", epgGrabSockPath)
	if err != nil {
		errors.Wrap(err, "fail to dial unix domain socket")
	}
	if conn == nil {
		return fmt.Errorf("conn is nil")
	}
	defer conn.Close()

	f, err := os.Open(epg2xmlXMLTVOutput)
	if err != nil {
		return errors.Wrap(err, "fail to open XMLTV file")
	}
	defer f.Close()

	if _, err := io.Copy(conn, f); err != nil {
		return errors.Wrap(err, "fail to send XMLTV file")
	}

	return nil
}
