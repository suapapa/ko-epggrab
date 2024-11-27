package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pkg/errors"
	"github.com/robfig/cron/v3"
)

var (
	flagFetchChannels    bool // Fetch channels from EPG providers.
	flagSendXMLTV2Socket bool // Send XMLTV file to Unix domain socket.
	flagListChannels     bool // List up channels.
	flagDeamonize        bool // Run as daemon.

	// Select channels from epg2xml_conf/Channel.json by EPG provider and category.
	// {EPGProvider1}:{Category1,Category2};{EPGProvider2}:{Category1};...
	// "NAVER:지상파"
	flagEPGProvidersCategories string

	// Select channels from epg2xml_conf/Channel.json by channel name.
	// {ChannelName1},{ChannelName2},...
	// "경인 KBS1,KBS2,MBC,SBS,EBS1,EBS2"
	flagNameFilter string

	cronMu sync.Mutex
)

func main() {
	flag.BoolVar(&flagFetchChannels, "fc", false, "Fetch channels from EPG providers.")
	flag.BoolVar(&flagListChannels, "lc", false, "List up channels in YAML format and exit.")
	flag.BoolVar(&flagSendXMLTV2Socket, "ss", false, "Send XMLTV file to Unix domain socket.")
	flag.StringVar(&flagEPGProvidersCategories, "pc", "NAVER:지상파", "Select channels from epg2xml channels by EPG provider and category.")
	flag.StringVar(&flagNameFilter, "nf", "", "Select channels from epg2xml channels by channel name.")
	flag.BoolVar(&flagDeamonize, "d", false, "Run as daemon.")
	flag.Parse()

	chNameFilter := makeAllowFilter(flagNameFilter)

	log.Println("Listing up channel candidates...")
	channels, err := EPG2XMLSearchChannels(flagFetchChannels)
	if err != nil {
		log.Fatal(err)
	}

	if flagListChannels {
		if err := listupChannels(channels); err != nil {
			log.Fatal(err)
		}
		return
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
	if len(pcs) == 0 {
		log.Fatal("Invalid EPG providers and categories")
	}

	for _, pc := range pcs {
		parts := strings.Split(pc, ":")
		if len(parts) != 2 {
			log.Fatalf("Invalid EPG provider and categories: %s", pc)
		}
		provider := parts[0]
		categorySelects := strings.Split(parts[1], ",")
		for _, category := range categorySelects {
			chs := epgProviderCategoryChannels[provider][category]
			if len(chNameFilter) == 0 {
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
			cronMu.Lock()
			defer cronMu.Unlock()
			log.Println("Fetching channels...")
			if _, err := EPG2XMLSearchChannels(true); err != nil {
				log.Printf("Fail to fetch channels: %v", err)
			}
		})
		if err != nil {
			log.Fatal(err)
		}
		_, err = c.AddFunc(cronGenerateXMLTV, func() {
			cronMu.Lock()
			defer cronMu.Unlock()
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
	conn, err := net.Dial("unix", xmlTVSockPath)
	if err != nil {
		errors.Wrap(err, "fail to dial unix domain socket")
	}
	if conn == nil {
		return fmt.Errorf("conn is nil")
	}
	defer conn.Close()

	f, err := os.Open(xmlTVXmlPath)
	if err != nil {
		return errors.Wrap(err, "fail to open XMLTV file")
	}
	defer f.Close()

	if _, err := io.Copy(conn, f); err != nil {
		return errors.Wrap(err, "fail to send XMLTV file")
	}

	return nil
}
