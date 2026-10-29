package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	paths := loadPathsFromEnv()
	if err := ensureParentDir(paths.KoEPGGrabConf); err != nil {
		log.Fatalf("fail to create conf dir: %v", err)
	}
	if err := ensureParentDir(paths.XMLTVXmlPath); err != nil {
		log.Fatalf("fail to create epggrab dir: %v", err)
	}

	cm, err := NewConfigManager(paths)
	if err != nil {
		log.Fatalf("fail to init config: %v", err)
	}

	logs := NewLogBuffer(logBufferLines)
	runner := NewEPG2XMLRunner(paths, logs)
	sched := NewScheduler(cm, runner, logs)

	if err := runner.EnsureProgramConfExists(); err != nil {
		log.Printf("warn: epg2xml init: %v", err)
	}

	if err := sched.Start(); err != nil {
		log.Fatalf("fail to start scheduler: %v", err)
	}
	defer sched.Stop()

	// Auto-fetch channels on first boot when channel DB is missing/empty.
	if !runner.ChannelFileExists() {
		log.Println("channel list missing; triggering initial fetch")
		go func() {
			if err := sched.FetchChannels(); err != nil {
				log.Printf("initial channel fetch failed: %v", err)
			}
		}()
	}

	srv := NewServer(cm, sched, runner, logs)
	httpServer := &http.Server{
		Addr:              paths.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("ko-epggrab web UI listening on %s", paths.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("received %v, shutting down...", sig)
	_ = httpServer.Close()
}
