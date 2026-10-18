package relay

import (
	"context"
	"encoding/json"
	"math/rand"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/store"
)

// benchClosing closes the first `remaining` connections it accepts.
type benchClosing struct {
	net.Listener
	remaining int32
}

func (l *benchClosing) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if atomic.AddInt32(&l.remaining, -1) >= 0 {
			c.Close()
			continue
		}
		return c, nil
	}
}

func benchFlaky(t *testing.T, fails int32) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })}
	go srv.Serve(&benchClosing{Listener: ln, remaining: fails})
	t.Cleanup(func() { srv.Close() })
	return "http://" + ln.Addr().String()
}

func benchRecord() store.Record {
	return store.Record{ID: "evt_net", EventType: "invoice.paid", Status: "queued", Body: json.RawMessage(`{"id":"evt_net"}`)}
}

func TestBenchRetriesNetworkErrors(t *testing.T) {
	r := &Relay{Client: &http.Client{Timeout: 5 * time.Second}, URL: benchFlaky(t, 3), Secret: []byte("s"),
		Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}, Max: 5, Base: time.Millisecond, Cap: 5 * time.Millisecond}
	if err := r.Forward(context.Background(), benchRecord()); err != nil {
		t.Fatalf("Forward after three dropped connections: %v", err)
	}
}

func TestBenchNetworkRetriesJittered(t *testing.T) {
	var slept []time.Duration
	r := &Relay{Client: &http.Client{Timeout: 5 * time.Second}, URL: benchFlaky(t, 3), Secret: []byte("s"),
		Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}, Sleep: func(d time.Duration) { slept = append(slept, d) },
		Rand: rand.New(rand.NewSource(1)), Max: 5, Base: 100 * time.Millisecond, Cap: 10 * time.Second}
	start := time.Now()
	if err := r.Forward(context.Background(), benchRecord()); err != nil {
		t.Fatalf("Forward: %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Forward took %v: it slept for real instead of through r.Sleep", elapsed)
	}
	if len(slept) != 3 {
		t.Fatalf("slept %v, want three waits through r.Sleep", slept)
	}
	distinct := map[time.Duration]bool{}
	for i, d := range slept {
		if ceiling := r.Base << i; d < 0 || d > ceiling {
			t.Fatalf("wait %d = %v outside [0, %v]", i, d, ceiling)
		}
		distinct[d] = true
	}
	if len(distinct) < 2 {
		t.Fatalf("waits %v are not jittered", slept)
	}
}
