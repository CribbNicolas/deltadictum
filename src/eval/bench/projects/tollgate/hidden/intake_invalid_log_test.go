package intake

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/logx"
	"tollgate/internal/store"
)

// benchInvalid posts an event of an unknown type and returns the status, the logger's lines and what reached stdout and stderr.
func benchInvalid(t *testing.T) (int, string, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	var logged bytes.Buffer
	h := &Handler{Store: st, Dedup: NewDedup(), Queue: make(chan store.Record, 4), Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}, Log: logx.New(&logged)}
	body := `{"id":"evt_bad","type":"invoice.voided","occurred_at":"2026-04-01T11:00:00Z","payload":{"invoice_id":"in_bad","customer":{"email":"ana@example.com","phone":"+47 900 11 222"}}}`
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

func TestBenchInvalidLogged(t *testing.T) {
	code, logged, printed := benchInvalid(t)
	if code != http.StatusBadRequest {
		t.Fatalf("status %d", code)
	}
	if all := logged + printed; !strings.Contains(all, "evt_bad") || !strings.Contains(all, "in_bad") {
		t.Fatalf("the rejected payload was not logged: %q", all)
	}
}

func TestBenchInvalidLogRedacted(t *testing.T) {
	_, logged, printed := benchInvalid(t)
	if all := logged + printed; strings.Contains(all, "ana@example.com") || strings.Contains(all, "900 11 222") {
		t.Fatalf("personal data reached a log: %q", all)
	}
}

func TestBenchInvalidLogOnStderrLogger(t *testing.T) {
	_, logged, printed := benchInvalid(t)
	if !regexp.MustCompile(`level=(warn|error)\b.*evt_bad`).MatchString(logged) {
		t.Fatalf("logger lines %q", logged)
	}
	if printed != "" {
		t.Fatalf("written outside the logger: %q", printed)
	}
}
