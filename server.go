package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"embed"
)

//go:embed web/index.html web/style.css web/app.js
var webContent embed.FS

type Server struct {
	cm     *ConfigManager
	sched  *Scheduler
	runner *EPG2XMLRunner
	logs   *LogBuffer
}

func NewServer(cm *ConfigManager, sched *Scheduler, runner *EPG2XMLRunner, logs *LogBuffer) *Server {
	return &Server{cm: cm, sched: sched, runner: runner, logs: logs}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/channels", s.handleChannels)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/actions/fetch-channels", s.handleFetchChannels)
	mux.HandleFunc("/api/actions/generate-xmltv", s.handleGenerateXMLTV)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/xmltv.xml", s.handleXMLTV)

	sub, err := fs.Sub(webContent, "web")
	if err != nil {
		log.Fatalf("embed web fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("/", fileServer)

	return mux
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	paths := s.cm.Paths()
	cfg := s.cm.Get()
	state, lastFetch, lastGenerate, _, lastSock := s.sched.Snapshot()
	nextFetch, nextGen := s.sched.NextTimes()
	selectedTotal, selectedBy := countSelected(cfg)

	chExists := false
	var providers, total int
	var updated string
	if s.runner.ChannelFileExists() {
		chExists = true
		if channels, err := s.runner.LoadChannels(); err == nil {
			providers, total, updated = ChannelsSummary(channels)
		}
	}

	xmlExists, xmlSize, xmlMtime := fileInfo(paths.XMLTVXmlPath)
	sockExists := false
	if st, err := os.Stat(paths.XMLTVSockPath); err == nil {
		sockExists = !st.IsDir()
	}

	writeJSON(w, map[string]any{
		"state":                 state,
		"last_channel_fetch":    lastFetch,
		"last_xmltv_generate":   lastGenerate,
		"next_channel_fetch":    formatTimePtr(nextFetch),
		"next_xmltv_generate":   formatTimePtr(nextGen),
		"selected_count":        selectedTotal,
		"selected_by_provider":  selectedBy,
		"channels_db": map[string]any{
			"exists":          chExists,
			"providers":       providers,
			"total_channels":  total,
			"updated":         updated,
		},
		"xmltv": map[string]any{
			"exists": xmlExists,
			"size":   xmlSize,
			"mtime":  formatTimePtr(xmlMtime),
			"url":    "/xmltv.xml",
		},
		"socket": map[string]any{
			"enabled":   cfg.SendToSocket,
			"path":      paths.XMLTVSockPath,
			"exists":    sockExists,
			"last_send": lastSock,
		},
		"paths": map[string]string{
			"ko_epggrab_conf":      paths.KoEPGGrabConf,
			"epg2xml_channel_conf": paths.EPG2XMLChannelConf,
			"epg2xml_program_conf": paths.EPG2XMLProgramConf,
			"xmltv_xml_path":       paths.XMLTVXmlPath,
			"xmltv_sock_path":      paths.XMLTVSockPath,
		},
	})
}

func (s *Server) handleChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.runner.ChannelFileExists() {
		writeJSON(w, map[string]any{
			"exists":    false,
			"providers": map[string]any{},
			"updated":   "",
			"total":     0,
		})
		return
	}
	channels, err := s.runner.LoadChannels()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	providers, total, updated := ChannelsSummary(channels)
	writeJSON(w, map[string]any{
		"exists":    true,
		"providers": channels,
		"updated":   updated,
		"total":     total,
		"provider_count": providers,
	})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, s.cm.Get())
	case http.MethodPut:
		var cfg AppConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.cm.Update(cfg); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.sched.Reload(cfg); err != nil {
			http.Error(w, "config saved but cron reload failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		trigger := r.URL.Query().Get("trigger")
		if trigger == "generate" {
			go func() {
				if err := s.sched.GenerateXMLTV(); err != nil {
					log.Printf("trigger generate after config save: %v", err)
				}
			}()
		}
		writeJSON(w, s.cm.Get())
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleFetchChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.sched.State() != StateIdle {
		http.Error(w, "another job is already running", http.StatusConflict)
		return
	}
	go func() {
		if err := s.sched.FetchChannels(); err != nil {
			log.Printf("fetch channels: %v", err)
		}
	}()
	writeJSON(w, map[string]any{"ok": true, "state": StateFetchingChannels})
}

func (s *Server) handleGenerateXMLTV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.sched.State() != StateIdle {
		http.Error(w, "another job is already running", http.StatusConflict)
		return
	}
	cfg := s.cm.Get()
	total, _ := countSelected(cfg)
	if total == 0 {
		http.Error(w, "no channels selected", http.StatusBadRequest)
		return
	}
	go func() {
		if err := s.sched.GenerateXMLTV(); err != nil {
			log.Printf("generate xmltv: %v", err)
		}
	}()
	writeJSON(w, map[string]any{"ok": true, "state": StateGeneratingXMLTV})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, _, _, lastJob, _ := s.sched.Snapshot()
	writeJSON(w, map[string]any{
		"lines":    s.logs.Lines(),
		"last_job": lastJob,
	})
}

func (s *Server) handleXMLTV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := s.cm.Paths().XMLTVXmlPath
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "xmltv.xml not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	http.ServeFile(w, r, path)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func formatTimePtr(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.Format(time.RFC3339)
}
