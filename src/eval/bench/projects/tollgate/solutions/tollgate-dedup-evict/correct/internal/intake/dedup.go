package intake

import (
	"sync"
	"time"
)

// Dedup remembers event ids for Window. Past Max ids it forgets those
// older than Window first, never one inside the window.
type Dedup struct {
	Window time.Duration
	Max    int

	mu    sync.Mutex
	seen  map[string]time.Time
	order []seenAt
}

type seenAt struct {
	id string
	at time.Time
}

// NewDedup returns a Dedup with the production window.
func NewDedup() *Dedup {
	return &Dedup{Window: 72 * time.Hour, Max: 50000, seen: map[string]time.Time{}}
}

// Seen reports whether id was recorded within the window before now, and records it.
func (d *Dedup) Seen(id string, now time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if at, ok := d.seen[id]; ok && now.Sub(at) <= d.Window {
		return true
	}
	d.seen[id] = now
	d.order = append(d.order, seenAt{id, now})
	for len(d.seen) > d.Max && len(d.order) > 0 && now.Sub(d.order[0].at) > d.Window {
		if e := d.order[0]; d.seen[e.id].Equal(e.at) {
			delete(d.seen, e.id)
		}
		d.order = d.order[1:]
	}
	return false
}

// Len is the number of ids held.
func (d *Dedup) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.seen)
}
