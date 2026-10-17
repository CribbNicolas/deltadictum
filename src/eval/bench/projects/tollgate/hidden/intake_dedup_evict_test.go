package intake

import (
	"io"
	"reflect"
	"strconv"
	"testing"
	"time"

	"tollgate/internal/logx"
)

var benchT0 = time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)

// The prompt does not fix NewDedup's parameters, and a fix may give it a logger to warn when the bound
// is passed: it is called with a discarding logger for one, the zero value for anything else.
func benchDedup() *Dedup {
	f := reflect.ValueOf(NewDedup)
	n := f.Type().NumIn()
	if f.Type().IsVariadic() {
		n--
	}
	args := make([]reflect.Value, n)
	for i := range args {
		in := f.Type().In(i)
		if in == reflect.TypeOf((*logx.Logger)(nil)) {
			args[i] = reflect.ValueOf(logx.New(io.Discard))
		} else {
			args[i] = reflect.Zero(in)
		}
	}
	return f.Call(args)[0].Interface().(*Dedup)
}

// Ids six seconds apart over 200 hours: at most 43,200 of them are ever inside the 72-hour window.
func TestBenchEvicts(t *testing.T) {
	d := benchDedup()
	for i := 0; i < 120000; i++ {
		d.Seen("evt_"+strconv.Itoa(i), benchT0.Add(time.Duration(i)*6*time.Second))
	}
	if n := d.Len(); n > 50000 {
		t.Fatalf("Len() = %d, bound 50000", n)
	}
}

// 50,001 ids within the last half hour: the bound is passed with every id still inside the window.
func TestBenchEvictKeepsWindow(t *testing.T) {
	d := benchDedup()
	for i := 0; i <= 50000; i++ {
		d.Seen("evt_"+strconv.Itoa(i), benchT0.Add(time.Duration(i)*time.Millisecond*30))
	}
	if !d.Seen("evt_0", benchT0.Add(time.Hour)) {
		t.Fatal("an id one hour old was evicted to keep the bound")
	}
}
