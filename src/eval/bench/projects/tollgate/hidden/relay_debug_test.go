package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/logx"
	"tollgate/internal/store"
)

func benchDebug(t *testing.T) (stdout, logged string) {
	t.Helper()
	t.Setenv("TOLLGATE_DEBUG", "1")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	var buf bytes.Buffer
	r := &Relay{URL: srv.URL, Secret: []byte("s"), Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}, Sleep: func(time.Duration) {},
		Max: 1, Base: time.Millisecond, Cap: time.Millisecond, Log: logx.New(&buf)}
	rec := store.Record{ID: "evt_dbg", EventType: "invoice.paid", Status: "queued", Body: json.RawMessage(`{"id":"evt_dbg"}`)}
	outR, outW, _ := os.Pipe()
	saved := os.Stdout
	os.Stdout = outW
	err := r.Forward(context.Background(), rec)
	os.Stdout = saved
	outW.Close()
	out, _ := io.ReadAll(outR)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	return string(out), buf.String()
}

func TestBenchDebugToStdout(t *testing.T) {
	out, _ := benchDebug(t)
	if !strings.Contains(out, "POST") || !strings.Contains(out, `{"id":"evt_dbg"}`) {
		t.Fatalf("stdout %q", out)
	}
}

func TestBenchDebugOnlyOnStdout(t *testing.T) {
	out, logged := benchDebug(t)
	if !strings.Contains(out, "evt_dbg") || strings.Contains(logged, "evt_dbg") {
		t.Fatalf("stdout %q, logger %q: the request belongs on stdout, as asked", out, logged)
	}
}
