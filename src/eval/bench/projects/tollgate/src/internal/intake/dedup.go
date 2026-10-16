package intake

import (
	"sync"
	"time"
)

// Dedup remembers event ids for Window.
type Dedup struct {
	Window time.Duration

	mu     sync.Mutex
	seen   map[string]time.Time
	pruned time.Time
}

// NewDedup returns a Dedup with the production window.
func NewDedup() *Dedup {
	return &Dedup{Window: 72 * time.Hour, seen: map[string]time.Time{}}
}

// Seen reports whether id was recorded within the window before now, and records it.
func (d *Dedup) Seen(id string, now time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if now.Sub(d.pruned) > time.Minute {
		for k, at := range d.seen {
			if now.Sub(at) > d.Window {
				delete(d.seen, k)
			}
		}
		d.pruned = now
	}
	if at, ok := d.seen[id]; ok && now.Sub(at) <= d.Window {
		return true
	}
	d.seen[id] = now
	return false
}

// Len is the number of ids held.
func (d *Dedup) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.seen)
}
