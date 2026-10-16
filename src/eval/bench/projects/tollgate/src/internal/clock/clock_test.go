package clock

import (
	"testing"
	"time"
)

func TestFakeNowAndAdvance(t *testing.T) {
	start := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	f := &Fake{T: start}
	if !f.Now().Equal(start) {
		t.Fatalf("Now() = %v, want %v", f.Now(), start)
	}
	f.Advance(90 * time.Second)
	if want := start.Add(90 * time.Second); !f.Now().Equal(want) {
		t.Fatalf("after Advance, Now() = %v, want %v", f.Now(), want)
	}
}

func TestRealIsAClock(t *testing.T) {
	var c Clock = Real{}
	if c.Now().IsZero() {
		t.Fatal("Real.Now() returned the zero time")
	}
}
