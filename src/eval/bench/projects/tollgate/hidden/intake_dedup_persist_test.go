package intake

import (
	"path/filepath"
	"testing"
	"time"
)

func TestBenchDedupRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dedup.json")
	t0 := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	d := NewDedup()
	d.Seen("evt_a", t0)
	if err := d.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}
	d.Seen("evt_b", t0.Add(time.Minute))
	if err := d.Save(path); err != nil {
		t.Fatalf("Save over an existing file: %v", err)
	}
	loaded, err := LoadDedup(path)
	if err != nil {
		t.Fatalf("LoadDedup: %v", err)
	}
	if loaded.Window != 72*time.Hour {
		t.Fatalf("Window = %v", loaded.Window)
	}
	if !loaded.Seen("evt_a", t0.Add(time.Hour)) || !loaded.Seen("evt_b", t0.Add(time.Hour)) {
		t.Fatal("a saved id was forgotten")
	}
	if loaded.Seen("evt_c", t0.Add(time.Hour)) {
		t.Fatal("an unknown id was reported as seen")
	}
}
