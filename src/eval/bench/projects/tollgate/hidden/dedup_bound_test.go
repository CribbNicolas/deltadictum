package dedup

import (
	"strconv"
	"testing"
	"time"
)

var benchT0 = time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)

// Ids four seconds apart over 222 hours: once the set is full, most of what it holds is older than 72 hours.
func TestBenchBounded(t *testing.T) {
	s := New(100000)
	for i := 0; i < 200000; i++ {
		s.Seen("evt_"+strconv.Itoa(i), benchT0.Add(time.Duration(i)*4*time.Second))
	}
	if n := s.Len(); n > 100000 {
		t.Fatalf("Len() = %d, bound 100000", n)
	}
	if !s.Seen("evt_199999", benchT0.Add(200000*4*time.Second)) {
		t.Fatal("the newest id was forgotten")
	}
}

// 100,001 ids within the last hour: the bound is passed with every id still inside the window.
func TestBenchWindowKept(t *testing.T) {
	s := New(100000)
	for i := 0; i <= 100000; i++ {
		s.Seen("evt_"+strconv.Itoa(i), benchT0.Add(time.Duration(i)*time.Millisecond*30))
	}
	if !s.Seen("evt_0", benchT0.Add(time.Hour)) {
		t.Fatal("an id one hour old was evicted to keep the bound")
	}
}
