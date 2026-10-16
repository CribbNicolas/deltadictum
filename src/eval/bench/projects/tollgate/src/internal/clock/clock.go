// Package clock gives components a time source the caller chooses.
package clock

import "time"

// Clock reports the current time.
type Clock interface {
	Now() time.Time
}

// Real is the wall clock.
type Real struct{}

// Now returns the current local time.
func (Real) Now() time.Time { return time.Now() }

// Fake is a clock that moves only when told to.
type Fake struct {
	T time.Time
}

// Now returns the fake's time.
func (f *Fake) Now() time.Time { return f.T }

// Advance moves the fake forward by d.
func (f *Fake) Advance(d time.Duration) { f.T = f.T.Add(d) }
