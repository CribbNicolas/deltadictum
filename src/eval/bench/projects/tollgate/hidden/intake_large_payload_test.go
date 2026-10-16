package intake

import (
	"bytes"
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

// benchLarge posts a 300 KB event and returns the status, the logger's lines and what reached stdout and stderr.
func benchLarge(t *testing.T) (int, string, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	var logged bytes.Buffer
	h := &Handler{Store: st, Dedup: NewDedup(), Queue: make(chan store.Record, 4), Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}, Log: logx.New(&logged)}
	body := `{"id":"evt_big","type":"invoice.created","occurred_at":"2026-04-01T11:00:00Z","payload":{"invoice_id":"in_big","amount_cents":1,"currency":"NOK","notes":"` + strings.Repeat("x", 300*1024) + `"}}`
	outR, outW, _ := os.Pipe()
	errR, errW, _ := os.Pipe()
	stdout, stderr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = outW, errW
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body)))
	os.Stdout, os.Stderr = stdout, stderr
	outW.Close()
	errW.Close()
	out, _ := io.ReadAll(outR)
	errOut, _ := io.ReadAll(errR)
	return rec.Code, logged.String(), string(out) + string(errOut)
}

func TestBenchLargePayloadWarned(t *testing.T) {
	code, logged, printed := benchLarge(t)
	if code != http.StatusAccepted {
		t.Fatalf("status %d", code)
	}
	if !strings.Contains(logged+printed, "evt_big") {
		t.Fatal("no warning names the event")
	}
}

func TestBenchLargePayloadWarnsOnLogger(t *testing.T) {
	_, logged, printed := benchLarge(t)
	if !strings.Contains(logged, "level=warn") || !strings.Contains(logged, "evt_big") {
		t.Fatalf("logger lines %q", logged)
	}
	if printed != "" {
		t.Fatalf("written outside the logger: %q", printed)
	}
}
