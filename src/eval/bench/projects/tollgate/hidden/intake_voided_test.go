package intake

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/store"
)

func TestBenchVoidedAccepted(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h := &Handler{Store: st, Dedup: NewDedup(), Queue: make(chan store.Record, 1), Clock: &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}}
	body := `{"id":"evt_void","type":"invoice.voided","occurred_at":"2026-04-01T11:00:00Z","payload":{"invoice_id":"in_9","reason":"duplicate"}}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body)))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}
