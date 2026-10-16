package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func record(id string, at time.Time, status string) Record {
	return Record{ID: id, EventType: "invoice.paid", ReceivedAt: at, Status: status, Body: json.RawMessage(`{"id":"` + id + `"}`)}
}

func TestAppendAndReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	s.Append(record("evt_2", t0.Add(time.Minute), "queued"))
	s.Append(record("evt_1", t0, "queued"))
	s.Append(record("evt_1", t0, "delivered"))
	s.Close()

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, ok := s.Get("evt_1")
	if !ok || got.Status != "delivered" {
		t.Fatalf("Get(evt_1) = %+v, %v; the later line should win", got, ok)
	}
	list := s.List()
	if len(list) != 2 || list[0].ID != "evt_1" || list[1].ID != "evt_2" {
		t.Fatalf("List() = %+v", list)
	}
	if string(got.Body) != `{"id":"evt_1"}` {
		t.Fatalf("body = %s", got.Body)
	}
}

func TestOpenRefusesAnotherFormat(t *testing.T) {
	dir := t.TempDir()
	copyFile(t, filepath.Join("testdata", "v2.jsonl"), filepath.Join(dir, logName))
	if _, err := Open(dir); !errors.Is(err, ErrFormat) {
		t.Fatalf("Open(v2 log) err = %v, want ErrFormat", err)
	}
}

func TestMigrateFromEachOlderFormat(t *testing.T) {
	for _, name := range []string{"v1.jsonl", "v2.jsonl"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			copyFile(t, filepath.Join("testdata", name), filepath.Join(dir, logName))
			if err := Migrate(dir); err != nil {
				t.Fatal(err)
			}
			s, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			for _, r := range s.List() {
				if r.EventType == "" {
					t.Errorf("%s: empty event_type", r.ID)
				}
				if r.Status == "ok" {
					t.Errorf("%s: status ok not migrated", r.ID)
				}
			}
			if r, _ := s.Get("evt_a1"); name == "v1.jsonl" && (r.EventType != "unknown" || r.Status != "delivered") {
				t.Errorf("evt_a1 = %+v", r)
			}
		})
	}
}

func TestMigrateLeavesTheCurrentFormatAlone(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	s.Append(record("evt_1", time.Now().UTC(), "queued"))
	s.Close()
	before, _ := os.ReadFile(filepath.Join(dir, logName))
	if err := Migrate(dir); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(dir, logName))
	if string(before) != string(after) {
		t.Fatal("Migrate rewrote a current log")
	}
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	b, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, b, 0o644); err != nil {
		t.Fatal(err)
	}
}
