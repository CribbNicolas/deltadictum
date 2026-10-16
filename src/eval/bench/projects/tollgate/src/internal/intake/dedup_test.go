package intake

import (
	"testing"
	"time"
)

func TestSeenWithinTheWindow(t *testing.T) {
	d := NewDedup()
	now := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	if d.Seen("evt_1", now) {
		t.Fatal("a new id was reported as seen")
	}
	if !d.Seen("evt_1", now.Add(71*time.Hour)) {
		t.Fatal("an id 71 hours old was not seen")
	}
	if d.Seen("evt_1", now.Add(73*time.Hour)) {
		t.Fatal("an id 73 hours old was still seen")
	}
}

func TestOldEntriesArePruned(t *testing.T) {
	d := NewDedup()
	now := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	for _, id := range []string{"a", "b", "c"} {
		d.Seen(id, now)
	}
	d.Seen("d", now.Add(80*time.Hour))
	if d.Len() != 1 {
		t.Fatalf("Len() = %d after the window passed", d.Len())
	}
}
