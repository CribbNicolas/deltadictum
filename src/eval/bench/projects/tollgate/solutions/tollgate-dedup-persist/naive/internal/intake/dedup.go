package intake

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// Dedup remembers event ids for Window.
type Dedup struct {
	Window time.Duration

	mu   sync.Mutex
	seen map[string]time.Time
}

// NewDedup returns a Dedup with the production window.
func NewDedup() *Dedup {
	return &Dedup{Window: 72 * time.Hour, seen: map[string]time.Time{}}
}

// Seen reports whether id was recorded within the window before now, and records it.
func (d *Dedup) Seen(id string, now time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
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

// Save writes the ids and when each was seen to path, replacing the file atomically.
func (d *Dedup) Save(path string) error {
	d.mu.Lock()
	data, err := json.Marshal(d.seen)
	d.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadDedup reads a Dedup saved at path; a missing file is an empty Dedup.
func LoadDedup(path string) (*Dedup, error) {
	d := NewDedup()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return d, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &d.seen); err != nil {
		return nil, err
	}
	return d, nil
}
