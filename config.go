package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Paths holds bootstrap paths loaded from environment variables.
type Paths struct {
	HTTPAddr           string
	KoEPGGrabConf      string
	EPG2XMLChannelConf string
	EPG2XMLProgramConf string
	XMLTVXmlPath       string
	XMLTVSockPath      string
}

// AppConfig is the single source of truth persisted as ko-epggrab.json.
type AppConfig struct {
	CronChannelFetch  string                `json:"cron_channel_fetch"`
	CronGenerateXMLTV string                `json:"cron_generate_xmltv"`
	SendToSocket      bool                  `json:"send_to_socket"`
	EPG2XMLGlobal     EPG2XMLGlobalConfig   `json:"epg2xml_global"`
	SelectedChannels  map[string][]*Channel `json:"selected_channels"`
}

// ConfigManager guards runtime config with an RWMutex.
type ConfigManager struct {
	mu    sync.RWMutex
	paths Paths
	cfg   AppConfig
}

func defaultPaths() Paths {
	return Paths{
		HTTPAddr:           ":8080",
		KoEPGGrabConf:      "./epg2xml_conf/ko-epggrab.json",
		EPG2XMLChannelConf: "./epg2xml_conf/epg2xml_channels.json",
		EPG2XMLProgramConf: "./epg2xml_conf/epg2xml.json",
		XMLTVXmlPath:       "./epggrab/xmltv.xml",
		XMLTVSockPath:      "./epggrab/xmltv.sock",
	}
}

func loadPathsFromEnv() Paths {
	p := defaultPaths()
	if v := os.Getenv("HTTP_ADDR"); v != "" {
		p.HTTPAddr = v
	}
	if v := os.Getenv("KO_EPGGRAB_CONF"); v != "" {
		p.KoEPGGrabConf = v
	}
	if v := os.Getenv("EPG2XML_CHANNEL_CONF"); v != "" {
		p.EPG2XMLChannelConf = v
	}
	if v := os.Getenv("EPG2XML_PROGRAM_CONF"); v != "" {
		p.EPG2XMLProgramConf = v
	}
	if v := os.Getenv("XMLTV_XML_PATH"); v != "" {
		p.XMLTVXmlPath = v
	}
	if v := os.Getenv("XMLTV_SOCK_PATH"); v != "" {
		p.XMLTVSockPath = v
	}
	return p
}

func defaultEPG2XMLGlobal() EPG2XMLGlobalConfig {
	return EPG2XMLGlobalConfig{
		Enabled:               true,
		FetchLimit:            2,
		IDFormat:              "{ServiceId}.{Source.lower()}",
		AddRebroadcastToTitle: false,
		AddEpnumToTitle:       true,
		AddDescription:        true,
		AddXmltvNs:            false,
		GetMoreDetails:        false,
		AddChannelIcon:        true,
		HTTPProxy:             nil,
	}
}

func defaultAppConfig() AppConfig {
	cronFetch := "0 0 * * 1"
	cronGen := "0 */12 * * *"
	if v := os.Getenv("CRON_CHANNEL_FETCH"); v != "" {
		cronFetch = v
	}
	if v := os.Getenv("CRON_GENERATE_XMLTV"); v != "" {
		cronGen = v
	}
	return AppConfig{
		CronChannelFetch:  cronFetch,
		CronGenerateXMLTV: cronGen,
		SendToSocket:      true,
		EPG2XMLGlobal:     defaultEPG2XMLGlobal(),
		SelectedChannels:  map[string][]*Channel{},
	}
}

func NewConfigManager(paths Paths) (*ConfigManager, error) {
	cm := &ConfigManager{paths: paths}
	if err := cm.loadOrInit(); err != nil {
		return nil, err
	}
	return cm, nil
}

func (cm *ConfigManager) Paths() Paths {
	return cm.paths
}

func (cm *ConfigManager) Get() AppConfig {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cloneAppConfig(cm.cfg)
}

func (cm *ConfigManager) Update(cfg AppConfig) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if cfg.SelectedChannels == nil {
		cfg.SelectedChannels = map[string][]*Channel{}
	}
	if err := validateCron(cfg.CronChannelFetch); err != nil {
		return fmt.Errorf("invalid cron_channel_fetch: %w", err)
	}
	if err := validateCron(cfg.CronGenerateXMLTV); err != nil {
		return fmt.Errorf("invalid cron_generate_xmltv: %w", err)
	}
	cm.cfg = cfg
	if err := writeJSONAtomic(cm.paths.KoEPGGrabConf, cm.cfg); err != nil {
		return err
	}
	return writeEPG2XMLConfig(cm.paths.EPG2XMLProgramConf, cm.cfg)
}

func (cm *ConfigManager) loadOrInit() error {
	cfg := defaultAppConfig()

	if _, err := os.Stat(cm.paths.KoEPGGrabConf); err == nil {
		if err := readJSON(cm.paths.KoEPGGrabConf, &cfg); err != nil {
			return fmt.Errorf("fail to load ko-epggrab.json: %w", err)
		}
		if cfg.SelectedChannels == nil {
			cfg.SelectedChannels = map[string][]*Channel{}
		}
		cm.cfg = cfg
		return nil
	}

	// Seed from existing epg2xml.json if present (migration).
	if _, err := os.Stat(cm.paths.EPG2XMLProgramConf); err == nil {
		migrateFromEPG2XML(&cfg, cm.paths.EPG2XMLProgramConf)
	}

	cm.cfg = cfg
	if err := os.MkdirAll(filepath.Dir(cm.paths.KoEPGGrabConf), 0o755); err != nil {
		return err
	}
	if err := writeJSONAtomic(cm.paths.KoEPGGrabConf, cm.cfg); err != nil {
		return err
	}
	return writeEPG2XMLConfig(cm.paths.EPG2XMLProgramConf, cm.cfg)
}

func migrateFromEPG2XML(cfg *AppConfig, path string) {
	raw := make(map[string]json.RawMessage)
	if err := readJSON(path, &raw); err != nil {
		return
	}
	if gRaw, ok := raw["GLOBAL"]; ok {
		var g EPG2XMLGlobalConfig
		if err := json.Unmarshal(gRaw, &g); err == nil {
			cfg.EPG2XMLGlobal = g
		}
	}
	selected := map[string][]*Channel{}
	for key, val := range raw {
		if key == "GLOBAL" {
			continue
		}
		var sel ChannelSelection
		if err := json.Unmarshal(val, &sel); err != nil {
			continue
		}
		if len(sel.MyChannels) > 0 {
			selected[key] = sel.MyChannels
		}
	}
	if len(selected) > 0 {
		cfg.SelectedChannels = selected
	}
}

func writeEPG2XMLConfig(path string, cfg AppConfig) error {
	newConfig := EPG2XMLConfig{
		"GLOBAL": cfg.EPG2XMLGlobal,
	}
	for provider, chs := range cfg.SelectedChannels {
		if len(chs) == 0 {
			continue
		}
		newConfig[provider] = &ChannelSelection{MyChannels: chs}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeJSONAtomic(path, newConfig)
}

func writeJSONAtomic(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func cloneAppConfig(cfg AppConfig) AppConfig {
	out := cfg
	out.SelectedChannels = make(map[string][]*Channel, len(cfg.SelectedChannels))
	for k, chs := range cfg.SelectedChannels {
		cp := make([]*Channel, len(chs))
		for i, ch := range chs {
			if ch == nil {
				continue
			}
			c := *ch
			cp[i] = &c
		}
		out.SelectedChannels[k] = cp
	}
	return out
}

func serviceIDString(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		// JSON numbers decode as float64
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%v", t)
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	case json.Number:
		return t.String()
	default:
		return fmt.Sprintf("%v", t)
	}
}

func countSelected(cfg AppConfig) (total int, byProvider map[string]int) {
	byProvider = map[string]int{}
	for p, chs := range cfg.SelectedChannels {
		n := len(chs)
		if n == 0 {
			continue
		}
		byProvider[p] = n
		total += n
	}
	return total, byProvider
}
