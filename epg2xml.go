package main

import (
	"encoding/json"
	"os"
	"os/exec"

	"github.com/pkg/errors"
)

type EPG2XMLConfig map[string]any             // value can be EP2XMLGlobalConfig or ChannelSelection
type Channels map[string]*ChannelSearchResult // key is EPG provider name (e.g. KT, LG, SK, Naver, etc.)

type EPG2XMLGlobalConfig struct {
	Enabled               bool   `json:"ENABLED"`
	FetchLimit            int    `json:"FETCH_LIMIT"`
	IDFormat              string `json:"ID_FORMAT"`
	AddRebroadcastToTitle bool   `json:"ADD_REBROADCAST_TO_TITLE"`
	AddEpnumToTitle       bool   `json:"ADD_EPNUM_TO_TITLE"`
	AddDescription        bool   `json:"ADD_DESCRIPTION"`
	AddXmltvNs            bool   `json:"ADD_XMLTV_NS"`
	GetMoreDetails        bool   `json:"GET_MORE_DETAILS"`
	AddChannelIcon        bool   `json:"ADD_CHANNEL_ICON"`
	HTTPProxy             any    `json:"HTTP_PROXY,omitempty"`
}

type ChannelSelection struct {
	MyChannels []*Channel `json:"MY_CHANNELS"`
}

type ChannelSearchResult struct {
	Updated  string     `json:"UPDATED"`
	Total    int        `json:"TOTAL"`
	Channels []*Channel `json:"CHANNELS"`
}

type Channel struct {
	epgProvider string
	Name        string `json:"Name"`
	No          string `json:"No,omitempty"`
	ServiceID   any    `json:"ServiceId"` // string or int
	Category    string `json:"Category"`
}

func EPG2XMLMakeXMLTV(chs []*Channel) error {
	config := make(EPG2XMLConfig)
	if err := readJSON(epg2xmlProgramConf, &config); err != nil {
		return errors.Wrap(err, "fail to read epg2xml config")
	}

	newConfig := EPG2XMLConfig{
		"GLOBAL": config["GLOBAL"],
	}
	for _, ch := range chs {
		if newConfig[ch.epgProvider] == nil {
			newConfig[ch.epgProvider] = &ChannelSelection{}
		}
		newConfig[ch.epgProvider].(*ChannelSelection).MyChannels = append(newConfig[ch.epgProvider].(*ChannelSelection).MyChannels, ch)
	}

	f, err := os.Create(epg2xmlProgramConf)
	if err != nil {
		return errors.Wrap(err, "fail to create epg2xml config file")
	}
	defer f.Close()

	if err := json.NewEncoder(f).Encode(newConfig); err != nil {
		return errors.Wrap(err, "fail to encode json")
	}

	// epg2xml 이 설정파일을 재포멧하고 수동으로 살펴보라고 권장함.
	if err := runEPG2XML("run"); err != nil {
		return errors.Wrap(err, "fail to run epg2xml")
	}

	// 실제 xml 파일이 생성되는 곳.
	if err := runEPG2XML("run"); err != nil {
		return errors.Wrap(err, "fail to run epg2xml")
	}
	return nil
}

func EPG2XMLSearchChannels(fetch bool) (Channels, error) {
	// epg2xml 설정 파일이 없으면 채널 목록을 만들지 않고 종료.
	// 파일이 없는 경우 epg2xml 설정 파일을 먼저 만듦.
	if _, err := os.Stat(epg2xmlProgramConf); os.IsNotExist(err) {
		if err := runEPG2XML("run"); err != nil {
			return nil, errors.Wrap(err, "fail to initialize epg2xml")
		}
	}

	if fetch {
		if err := runEPG2XML("update_channels"); err != nil {
			return nil, errors.Wrap(err, "fail to update channels")
		}
	}

	channels := make(Channels)
	if err := readJSON(epg2xmlChannelConf, &channels); err != nil {
		return nil, errors.Wrap(err, "fail to read channel list")
	}

	return channels, nil
}

func runEPG2XML(command string) error {
	args := append([]string{
		"--config", epg2xmlProgramConf,
		"--channelfile", epg2xmlChannelConf,
		"--xmlfile", epg2xmlXMLTVOutput,
	}, command)
	cmd := exec.Command("epg2xml", args...)

	// 표준 출력과 오류를 현재 프로세스와 연결
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// 명령 실행
	if err := cmd.Run(); err != nil {
		return errors.Wrap(err, "fail to run epg2xml")
	}

	return nil
}

func readJSON(file string, v any) error {
	f, err := os.Open(file)
	if err != nil {
		return errors.Wrap(err, "fail to read json file")
	}
	defer f.Close()

	if err := json.NewDecoder(f).Decode(v); err != nil {
		return errors.Wrap(err, "fail to decode json")
	}

	return nil
}
