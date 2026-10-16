// Package store keeps every delivery in an append-only JSON lines log.
package store

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// FormatVersion is the format of the delivery log this package reads and writes.
const FormatVersion = 3

const logName = "deliveries.jsonl"

// ErrFormat reports a delivery log in a format this version does not read.
var ErrFormat = errors.New("store: unsupported log format")

// Record is one delivery. A later line for the same id replaces the earlier one.
type Record struct {
	ID         string          `json:"id"`
	EventType  string          `json:"event_type"`
	ReceivedAt time.Time       `json:"received_at"`
	Status     string          `json:"status"`
	LastError  string          `json:"last_error,omitempty"`
	Attempts   int             `json:"attempts"`
	Body       json.RawMessage `json:"body"`
}

type header struct {
	Format int `json:"format"`
}

// Store is an open delivery log.
type Store struct {
	mu   sync.Mutex
	dir  string
	f    *os.File
	recs map[string]Record
}

// Open reads the delivery log in dir, creating it if needed, and keeps it open for appending.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, logName)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		h, _ := json.Marshal(header{Format: FormatVersion})
		if err := os.WriteFile(path, append(h, '\n'), 0o644); err != nil {
			return nil, err
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	s := &Store{dir: dir, recs: map[string]Record{}}
	if err := s.read(data); err != nil {
		return nil, err
	}
	s.f, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) read(data []byte) error {
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64*1024), 16<<20)
	if !sc.Scan() {
		return fmt.Errorf("%w: empty log", ErrFormat)
	}
	var h header
	if err := json.Unmarshal(sc.Bytes(), &h); err != nil || h.Format != FormatVersion {
		return fmt.Errorf("%w: %d", ErrFormat, h.Format)
	}
	for sc.Scan() {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			continue
		}
		var r Record
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			return fmt.Errorf("store: bad line: %w", err)
		}
		s.recs[r.ID] = r
	}
	return sc.Err()
}

// Dir is the folder the log lives in.
func (s *Store) Dir() string { return s.dir }

// Append writes r as a new line.
func (s *Store) Append(r Record) error {
	line, err := json.Marshal(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.f.Write(append(line, '\n')); err != nil {
		return err
	}
	s.recs[r.ID] = r
	return nil
}

// Get returns the latest record for id.
func (s *Store) Get(id string) (Record, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[id]
	return r, ok
}

// List returns the latest record of every delivery, oldest first.
func (s *Store) List() []Record {
	s.mu.Lock()
	out := make([]Record, 0, len(s.recs))
	for _, r := range s.recs {
		out = append(out, r)
	}
	s.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].ReceivedAt.Equal(out[j].ReceivedAt) {
			return out[i].ReceivedAt.Before(out[j].ReceivedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Close closes the log.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.f.Close()
}
