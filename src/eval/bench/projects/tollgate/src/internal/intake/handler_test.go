package intake

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/store"
)

type fixture struct {
	h     *Handler
	queue chan store.Record
	store *store.Store
	clock *clock.Fake
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	q := make(chan store.Record, 16)
	c := &clock.Fake{T: time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)}
	return fixture{h: &Handler{Store: st, Dedup: NewDedup(), Queue: q, Clock: c}, queue: q, store: st, clock: c}
}

func post(h http.Handler, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body)))
	return rec
}

const paid = `{"id":"evt_1","type":"invoice.paid","occurred_at":"2026-04-01T11:59:00Z","payload":{"invoice_id":"in_1","paid_at":"2026-04-01T11:58:00Z"}}`

func TestAcceptStoresAndQueues(t *testing.T) {
	f := newFixture(t)
	res := post(f.h, paid)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status %d: %s", res.Code, res.Body)
	}
	r, ok := f.store.Get("evt_1")
	if !ok || r.Status != "queued" || r.EventType != "invoice.paid" || !r.ReceivedAt.Equal(f.clock.T) {
		t.Fatalf("stored %+v, %v", r, ok)
	}
	if string(r.Body) != paid {
		t.Fatalf("stored body %s", r.Body)
	}
	select {
	case q := <-f.queue:
		if q.ID != "evt_1" {
			t.Fatalf("queued %s", q.ID)
		}
	default:
		t.Fatal("nothing queued")
	}
}

func TestDuplicateIsNotQueuedTwice(t *testing.T) {
	f := newFixture(t)
	post(f.h, paid)
	res := post(f.h, paid)
	var out map[string]string
	json.Unmarshal(res.Body.Bytes(), &out)
	if res.Code != http.StatusOK || out["status"] != "duplicate" {
		t.Fatalf("second post: %d %s", res.Code, res.Body)
	}
	if len(f.queue) != 1 {
		t.Fatalf("queue holds %d", len(f.queue))
	}
}

func TestInvalidEventsAreRejected(t *testing.T) {
	cases := map[string]string{
		"bad json":     `{"id":`,
		"missing id":   `{"type":"invoice.paid","payload":{}}`,
		"unknown type": `{"id":"evt_9","type":"invoice.lost","payload":{}}`,
		"no payload":   `{"id":"evt_9","type":"invoice.paid"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			res := post(f.h, body)
			if res.Code != http.StatusBadRequest {
				t.Fatalf("status %d", res.Code)
			}
			var out map[string]string
			if json.Unmarshal(res.Body.Bytes(), &out) != nil || out["error"] == "" {
				t.Fatalf("body %s", res.Body)
			}
			if len(f.store.List()) != 0 {
				t.Fatal("an invalid event was stored")
			}
		})
	}
}

func TestOnlyPost(t *testing.T) {
	f := newFixture(t)
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/events", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status %d", rec.Code)
	}
}
