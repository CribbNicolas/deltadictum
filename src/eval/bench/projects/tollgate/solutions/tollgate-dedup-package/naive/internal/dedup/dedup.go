// Package dedup remembers event ids for a window, within a memory bound.
package dedup

import (
	"sync"
	"time"
)

// Window is how long an id is remembered.
const Window = 72 * time.Hour

type entry struct {
	id string
	at time.Time
}

// Set holds the ids seen within Window. Past Max ids it forgets the oldest.
type Set struct {
	Max int

	mu    sync.Mutex
	seen  map[string]time.Time
	order []entry
}

// New returns a Set bounded to max ids.
func New(max int) *Set { return &Set{Max: max, seen: map[string]time.Time{}} }

// Seen reports whether id was recorded within the window before now, and records it.
func (s *Set) Seen(id string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if at, ok := s.seen[id]; ok && now.Sub(at) <= Window {
		return true
	}
	s.seen[id] = now
	s.order = append(s.order, entry{id, now})
	for len(s.seen) > s.Max && len(s.order) > 0 {
		if e := s.order[0]; s.seen[e.id].Equal(e.at) {
			delete(s.seen, e.id)
		}
		s.order = s.order[1:]
	}
	return false
}

// Len is the number of ids held.
func (s *Set) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.seen)
}
