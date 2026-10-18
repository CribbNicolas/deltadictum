package relay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/sign"
	"tollgate/internal/store"
)

var (
	benchSecret   = []byte("whsec_bench")
	benchNow      = time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	benchReceived = time.Date(2026, 4, 1, 11, 30, 0, 0, time.UTC)
)

type benchCapture struct {
	mu     sync.Mutex
	bodies [][]byte
	sigs   []string
}

func benchForward(t *testing.T) *benchCapture {
	t.Helper()
	got := &benchCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got.mu.Lock()
		got.bodies = append(got.bodies, b)
		got.sigs = append(got.sigs, r.Header.Get("X-Meridian-Signature"))
		got.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	r := &Relay{URL: srv.URL, Secret: benchSecret, Clock: &clock.Fake{T: benchNow}, Sleep: func(time.Duration) {}, Max: 1,
		Base: time.Millisecond, Cap: time.Millisecond}
	rec := store.Record{ID: "evt_bench", EventType: "invoice.paid", ReceivedAt: benchReceived, Status: "queued",
		Body: json.RawMessage(`{"id":"evt_bench","type":"invoice.paid","occurred_at":"2026-04-01T11:29:00Z","payload":{"invoice_id":"in_1"}}`)}
	if err := r.Forward(context.Background(), rec); err != nil {
		t.Fatalf("Forward: %v", err)
	}
	if len(got.bodies) != 1 {
		t.Fatalf("%d requests", len(got.bodies))
	}
	return got
}

func TestBenchReceivedAtField(t *testing.T) {
	got := benchForward(t)
	var m map[string]any
	if err := json.Unmarshal(got.bodies[0], &m); err != nil {
		t.Fatalf("body is not JSON: %s", got.bodies[0])
	}
	if m["tollgate_received_at"] != "2026-04-01T11:30:00Z" || m["id"] != "evt_bench" {
		t.Fatalf("body %s", got.bodies[0])
	}
}

func TestBenchSignatureMatchesBody(t *testing.T) {
	got := benchForward(t)
	if err := sign.VerifyV2(benchSecret, got.bodies[0], got.sigs[0], benchNow, 5*time.Minute); err != nil {
		t.Fatalf("signature does not verify over the bytes sent: %v", err)
	}
}
