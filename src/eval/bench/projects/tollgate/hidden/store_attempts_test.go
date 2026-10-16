package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBenchAttemptsRecorded(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.Append(Record{ID: "evt_att", EventType: "invoice.paid", ReceivedAt: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC), Status: "delivered",
		Attempts: 3, Body: json.RawMessage(`{"id":"evt_att"}`)})
	s.Close()
	raw, _ := os.ReadFile(filepath.Join(dir, "deliveries.jsonl"))
	if !strings.Contains(string(raw), `"attempts":3`) {
		t.Fatalf("log %s", raw)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if r, _ := s.Get("evt_att"); r.Attempts != 3 {
		t.Fatalf("reopened %+v", r)
	}
}

func TestBenchFormatBumped(t *testing.T) {
	if FormatVersion != 4 {
		t.Fatalf("FormatVersion = %d", FormatVersion)
	}
}

func TestBenchMigratesV3(t *testing.T) {
	dir := t.TempDir()
	v3 := "{\"format\":3}\n{\"id\":\"evt_v3\",\"event_type\":\"invoice.paid\",\"received_at\":\"2026-03-01T10:00:00Z\",\"status\":\"delivered\",\"body\":{\"id\":\"evt_v3\"}}\n"
	if err := os.WriteFile(filepath.Join(dir, "deliveries.jsonl"), []byte(v3), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(dir); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("Open after Migrate: %v", err)
	}
	defer s.Close()
	if r, ok := s.Get("evt_v3"); !ok || r.Attempts != 0 || r.Status != "delivered" {
		t.Fatalf("migrated %+v, %v", r, ok)
	}
}
