package main

import (
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

type JobState string

const (
	StateIdle             JobState = "idle"
	StateFetchingChannels JobState = "fetching_channels"
	StateGeneratingXMLTV  JobState = "generating_xmltv"
)

type JobType string

const (
	JobFetchChannels JobType = "fetch_channels"
	JobGenerateXMLTV JobType = "generate_xmltv"
)

type JobResult struct {
	Type       JobType   `json:"type"`
	StartedAt  time.Time `json:"started_at"`
	FinishedAt time.Time `json:"finished_at"`
	DurationMs int64     `json:"duration_ms"`
	Success    bool      `json:"success"`
	Error      string    `json:"error,omitempty"`
}

type SocketSendResult struct {
	At      time.Time `json:"at"`
	Success bool      `json:"success"`
	Error   string    `json:"error,omitempty"`
}

const logBufferLines = 1000

// LogBuffer is a concurrent ring buffer of log lines.
type LogBuffer struct {
	mu     sync.RWMutex
	lines  []string
	max    int
	partial string
}

func NewLogBuffer(max int) *LogBuffer {
	if max <= 0 {
		max = logBufferLines
	}
	return &LogBuffer{max: max}
}

func (b *LogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.partial += string(p)
	for {
		i := strings.IndexByte(b.partial, '\n')
		if i < 0 {
			break
		}
		b.pushLineLocked(b.partial[:i])
		b.partial = b.partial[i+1:]
	}
	return len(p), nil
}

func (b *LogBuffer) Append(s string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pushLineLocked(strings.TrimRight(s, "\n"))
}

func (b *LogBuffer) pushLineLocked(line string) {
	if line == "" {
		return
	}
	if !strings.HasPrefix(line, "[") {
		line = time.Now().Format("2006-01-02 15:04:05") + " " + line
	}
	b.lines = append(b.lines, line)
	if len(b.lines) > b.max {
		b.lines = b.lines[len(b.lines)-b.max:]
	}
}

func (b *LogBuffer) Lines() []string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]string, len(b.lines))
	copy(out, b.lines)
	return out
}

var _ io.Writer = (*LogBuffer)(nil)

// Scheduler manages cron jobs, manual triggers, and job status.
type Scheduler struct {
	mu sync.Mutex

	cm     *ConfigManager
	runner *EPG2XMLRunner
	logs   *LogBuffer

	cron            *cron.Cron
	fetchEntryID    cron.EntryID
	generateEntryID cron.EntryID

	state            JobState
	lastFetch        *JobResult
	lastGenerate     *JobResult
	lastSocketSend   *SocketSendResult
	lastJob          *JobResult
	busy             bool
}

func NewScheduler(cm *ConfigManager, runner *EPG2XMLRunner, logs *LogBuffer) *Scheduler {
	return &Scheduler{
		cm:     cm,
		runner: runner,
		logs:   logs,
		cron:   cron.New(),
		state:  StateIdle,
	}
}

func validateCron(expr string) error {
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	_, err := parser.Parse(expr)
	return err
}

func (s *Scheduler) Start() error {
	cfg := s.cm.Get()
	if err := s.reloadLocked(cfg); err != nil {
		return err
	}
	s.cron.Start()
	return nil
}

func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

func (s *Scheduler) Reload(cfg AppConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reloadLocked(cfg)
}

func (s *Scheduler) reloadLocked(cfg AppConfig) error {
	if s.fetchEntryID != 0 {
		s.cron.Remove(s.fetchEntryID)
		s.fetchEntryID = 0
	}
	if s.generateEntryID != 0 {
		s.cron.Remove(s.generateEntryID)
		s.generateEntryID = 0
	}

	id, err := s.cron.AddFunc(cfg.CronChannelFetch, func() {
		if err := s.FetchChannels(); err != nil {
			log.Printf("cron channel fetch failed: %v", err)
		}
	})
	if err != nil {
		return fmt.Errorf("cron_channel_fetch: %w", err)
	}
	s.fetchEntryID = id

	id, err = s.cron.AddFunc(cfg.CronGenerateXMLTV, func() {
		if err := s.GenerateXMLTV(); err != nil {
			log.Printf("cron generate xmltv failed: %v", err)
		}
	})
	if err != nil {
		return fmt.Errorf("cron_generate_xmltv: %w", err)
	}
	s.generateEntryID = id
	return nil
}

func (s *Scheduler) NextTimes() (fetch, generate time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fetchEntryID != 0 {
		fetch = s.cron.Entry(s.fetchEntryID).Next
	}
	if s.generateEntryID != 0 {
		generate = s.cron.Entry(s.generateEntryID).Next
	}
	return fetch, generate
}

func (s *Scheduler) State() JobState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Scheduler) Snapshot() (state JobState, lastFetch, lastGenerate, lastJob *JobResult, lastSock *SocketSendResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state, cloneJob(s.lastFetch), cloneJob(s.lastGenerate), cloneJob(s.lastJob), cloneSock(s.lastSocketSend)
}

func cloneJob(j *JobResult) *JobResult {
	if j == nil {
		return nil
	}
	cp := *j
	return &cp
}

func cloneSock(s *SocketSendResult) *SocketSendResult {
	if s == nil {
		return nil
	}
	cp := *s
	return &cp
}

func (s *Scheduler) FetchChannels() error {
	if !s.tryBegin(StateFetchingChannels) {
		return fmt.Errorf("another job is already running")
	}
	started := time.Now()
	s.logs.Append(fmt.Sprintf("=== 채널 목록 갱신 시작 (%s) ===", started.Format(time.RFC3339)))

	err := s.runner.UpdateChannels()
	result := &JobResult{
		Type:       JobFetchChannels,
		StartedAt:  started,
		FinishedAt: time.Now(),
		DurationMs: time.Since(started).Milliseconds(),
		Success:    err == nil,
	}
	if err != nil {
		result.Error = err.Error()
		s.logs.Append(fmt.Sprintf("[ERROR] 채널 목록 갱신 실패: %v", err))
	} else {
		s.logs.Append("채널 목록 갱신 완료")
	}
	s.finish(result)
	return err
}

func (s *Scheduler) GenerateXMLTV() error {
	if !s.tryBegin(StateGeneratingXMLTV) {
		return fmt.Errorf("another job is already running")
	}
	started := time.Now()
	s.logs.Append(fmt.Sprintf("=== XMLTV 생성 시작 (%s) ===", started.Format(time.RFC3339)))

	cfg := s.cm.Get()
	total, _ := countSelected(cfg)
	var err error
	if total == 0 {
		err = fmt.Errorf("선택된 채널이 없습니다")
		s.logs.Append("[ERROR] " + err.Error())
	} else {
		err = s.runner.MakeXMLTV(cfg)
		if err != nil {
			s.logs.Append(fmt.Sprintf("[ERROR] XMLTV 생성 실패: %v", err))
		} else {
			s.logs.Append("XMLTV 생성 완료")
			if cfg.SendToSocket {
				if sendErr := s.sendToSocket(); sendErr != nil {
					s.logs.Append(fmt.Sprintf("[ERROR] 소켓 전송 실패: %v", sendErr))
					// Do not fail the whole job solely on socket send; record separately.
				} else {
					s.logs.Append("소켓 전송 완료")
				}
			}
		}
	}

	result := &JobResult{
		Type:       JobGenerateXMLTV,
		StartedAt:  started,
		FinishedAt: time.Now(),
		DurationMs: time.Since(started).Milliseconds(),
		Success:    err == nil,
	}
	if err != nil {
		result.Error = err.Error()
	}
	s.finish(result)
	return err
}

func (s *Scheduler) tryBegin(state JobState) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busy {
		return false
	}
	s.busy = true
	s.state = state
	return true
}

func (s *Scheduler) finish(result *JobResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.busy = false
	s.state = StateIdle
	s.lastJob = result
	switch result.Type {
	case JobFetchChannels:
		s.lastFetch = result
	case JobGenerateXMLTV:
		s.lastGenerate = result
	}
}

func (s *Scheduler) sendToSocket() error {
	paths := s.cm.Paths()
	err := sendXMLTV2Socket(paths.XMLTVSockPath, paths.XMLTVXmlPath)
	res := &SocketSendResult{At: time.Now(), Success: err == nil}
	if err != nil {
		res.Error = err.Error()
	}
	s.mu.Lock()
	s.lastSocketSend = res
	s.mu.Unlock()
	return err
}

func sendXMLTV2Socket(sockPath, xmlPath string) error {
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return errors.Wrap(err, "fail to dial unix domain socket")
	}
	defer conn.Close()

	f, err := os.Open(xmlPath)
	if err != nil {
		return errors.Wrap(err, "fail to open XMLTV file")
	}
	defer f.Close()

	if _, err := io.Copy(conn, f); err != nil {
		return errors.Wrap(err, "fail to send XMLTV file")
	}
	return nil
}
