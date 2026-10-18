package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBenchCompact(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	add := func(id, status string, age time.Duration) {
		s.Append(Record{ID: id, EventType: "invoice.paid", ReceivedAt: now.Add(-age), Status: status, Body: json.RawMessage(`{"id":"` + id + `"}`)})
	}
	add("evt_old_delivered", "queued", 40*24*time.Hour)
	add("evt_old_delivered", "delivered", 40*24*time.Hour)
	add("evt_old_failed", "failed", 40*24*time.Hour)
	add("evt_new", "queued", time.Hour)
	add("evt_new", "delivered", time.Hour)
	add("evt_pending", "queued", 2*time.Hour)
	s.Close()

	if err := Compact(dir, now); err != nil {
		t.Fatalf("Compact: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "deliveries.jsonl"))
	if lines := strings.Split(strings.TrimSpace(string(raw)), "\n"); len(lines) != 4 {
		t.Fatalf("compacted log has %d lines, want the header and three deliveries:\n%s", len(lines), raw)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatalf("Open after Compact: %v", err)
	}
	defer s.Close()
	var ids []string
	for _, r := range s.List() {
		ids = append(ids, r.ID+":"+r.Status)
	}
	if got := strings.Join(ids, ","); got != "evt_old_failed:failed,evt_pending:queued,evt_new:delivered" {
		t.Fatalf("kept %s", got)
	}
}
