package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
)

type EPG2XMLConfig map[string]any // value can be EPG2XMLGlobalConfig or ChannelSelection
type Channels map[string]*ChannelSearchResult

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
	HTTPProxy             any    `json:"HTTP_PROXY"`
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
	Name      string `json:"Name"`
	No        string `json:"No,omitempty"`
	ServiceID any    `json:"ServiceId"`
	Category  string `json:"Category"`
	IconURL   string `json:"Icon_url,omitempty"`
	Id        any    `json:"Id,omitempty"`
}

// EPG2XMLRunner executes epg2xml CLI commands and regenerates configs.
type EPG2XMLRunner struct {
	paths  Paths
	logger *LogBuffer
}

func NewEPG2XMLRunner(paths Paths, logger *LogBuffer) *EPG2XMLRunner {
	return &EPG2XMLRunner{paths: paths, logger: logger}
}

func (r *EPG2XMLRunner) EnsureProgramConfExists() error {
	if _, err := os.Stat(r.paths.EPG2XMLProgramConf); os.IsNotExist(err) {
		cfg := defaultAppConfig()
		if err := writeEPG2XMLConfig(r.paths.EPG2XMLProgramConf, cfg); err != nil {
			return err
		}
		// Let epg2xml materialize a full default config.
		return r.run("run")
	}
	return nil
}

func (r *EPG2XMLRunner) ChannelFileExists() bool {
	st, err := os.Stat(r.paths.EPG2XMLChannelConf)
	return err == nil && st.Size() > 0
}

func (r *EPG2XMLRunner) LoadChannels() (Channels, error) {
	channels := make(Channels)
	if err := readJSON(r.paths.EPG2XMLChannelConf, &channels); err != nil {
		return nil, errors.Wrap(err, "fail to read channel list")
	}
	return channels, nil
}

func (r *EPG2XMLRunner) UpdateChannels() error {
	if err := r.EnsureProgramConfExists(); err != nil {
		return errors.Wrap(err, "fail to initialize epg2xml")
	}
	_ = os.Remove(r.paths.EPG2XMLChannelConf)
	if err := r.run("update_channels"); err != nil {
		return errors.Wrap(err, "fail to update channels")
	}
	return nil
}

// MakeXMLTV writes epg2xml.json from AppConfig (with refreshed channel metadata) and runs epg2xml.
func (r *EPG2XMLRunner) MakeXMLTV(cfg AppConfig) error {
	channels, err := r.LoadChannels()
	if err != nil {
		return errors.Wrap(err, "fail to load channels for XMLTV generation")
	}

	synced := syncSelectedWithDB(cfg.SelectedChannels, channels)
	cfg.SelectedChannels = synced

	if err := writeEPG2XMLConfig(r.paths.EPG2XMLProgramConf, cfg); err != nil {
		return errors.Wrap(err, "fail to write epg2xml config")
	}

	// epg2xml reformats the config on first run, then produces XMLTV on the second.
	if err := r.run("run"); err != nil {
		return errors.Wrap(err, "fail to run epg2xml (pass 1)")
	}
	if err := r.run("run"); err != nil {
		return errors.Wrap(err, "fail to run epg2xml (pass 2)")
	}
	return nil
}

func syncSelectedWithDB(selected map[string][]*Channel, db Channels) map[string][]*Channel {
	out := make(map[string][]*Channel, len(selected))
	for provider, chs := range selected {
		result, ok := db[provider]
		index := map[string]*Channel{}
		if ok {
			for _, ch := range result.Channels {
				index[serviceIDString(ch.ServiceID)] = ch
			}
		}
		synced := make([]*Channel, 0, len(chs))
		for _, ch := range chs {
			if ch == nil {
				continue
			}
			key := serviceIDString(ch.ServiceID)
			if fresh, ok := index[key]; ok {
				cp := *fresh
				synced = append(synced, &cp)
			} else {
				cp := *ch
				synced = append(synced, &cp)
			}
		}
		if len(synced) > 0 {
			out[provider] = synced
		}
	}
	return out
}

func (r *EPG2XMLRunner) run(command string) error {
	args := []string{
		"--config", r.paths.EPG2XMLProgramConf,
		"--channelfile", r.paths.EPG2XMLChannelConf,
		"--xmlfile", r.paths.XMLTVXmlPath,
		command,
	}
	cmd := exec.Command("epg2xml", args...)

	var writers []io.Writer
	writers = append(writers, os.Stdout)
	if r.logger != nil {
		writers = append(writers, r.logger)
	}
	mw := io.MultiWriter(writers...)
	cmd.Stdout = mw
	cmd.Stderr = mw

	r.logf("$ epg2xml %s", command)
	if err := cmd.Run(); err != nil {
		return errors.Wrap(err, "fail to run epg2xml")
	}
	return nil
}

func (r *EPG2XMLRunner) logf(format string, args ...any) {
	if r.logger == nil {
		return
	}
	fmt.Fprintf(r.logger, format+"\n", args...)
}

func ChannelsSummary(channels Channels) (providers int, total int, updated string) {
	providers = len(channels)
	var latest time.Time
	for _, sr := range channels {
		if sr == nil {
			continue
		}
		total += sr.Total
		if sr.Total == 0 {
			total += len(sr.Channels)
		}
		if t, err := time.Parse(time.RFC3339Nano, sr.Updated); err == nil {
			if t.After(latest) {
				latest = t
				updated = sr.Updated
			}
		} else if sr.Updated != "" && updated == "" {
			updated = sr.Updated
		}
	}
	return providers, total, updated
}

func fileInfo(path string) (exists bool, size int64, mtime time.Time) {
	st, err := os.Stat(path)
	if err != nil {
		return false, 0, time.Time{}
	}
	return true, st.Size(), st.ModTime()
}

func ensureParentDir(path string) error {
	return os.MkdirAll(filepath.Dir(path), 0o755)
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
