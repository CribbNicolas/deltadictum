package relay

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/store"
)

var benchFake = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

func benchSentAt(t *testing.T) string {
	t.Helper()
	var header string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.Header.Get("X-Tollgate-Sent-At")
	}))
	defer srv.Close()
	r := &Relay{URL: srv.URL, Secret: []byte("s"), Clock: &clock.Fake{T: benchFake}, Sleep: func(time.Duration) {}, Max: 1, Base: time.Millisecond, Cap: time.Millisecond}
	rec := store.Record{ID: "evt_sent", EventType: "invoice.paid", ReceivedAt: benchFake.Add(-time.Hour), Status: "queued", Body: json.RawMessage(`{"id":"evt_sent"}`)}
	if err := r.Forward(context.Background(), rec); err != nil {
		t.Fatalf("Forward: %v", err)
	}
	return header
}

func TestBenchSentAtHeader(t *testing.T) {
	if _, err := time.Parse(time.RFC3339, benchSentAt(t)); err != nil {
		t.Fatalf("X-Tollgate-Sent-At is not RFC 3339: %v", err)
	}
}

func TestBenchSentAtFromClock(t *testing.T) {
	if got := benchSentAt(t); got != "2026-01-02T03:04:05Z" {
		t.Fatalf("X-Tollgate-Sent-At = %q, want the relay clock's time", got)
	}
}
