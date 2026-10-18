package relay

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand"
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
	secret = []byte("whsec_test")
	now    = time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
)

// partner answers with the given statuses in turn (the last one repeats) and
// refuses any request whose signature does not verify.
type partner struct {
	mu       sync.Mutex
	statuses []int
	headers  map[string]string
	bodies   [][]byte
}

func (p *partner) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.bodies = append(p.bodies, body)
	if err := sign.VerifyV2(secret, body, r.Header.Get("X-Meridian-Signature"), now, 5*time.Minute); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	status := p.statuses[0]
	if len(p.statuses) > 1 {
		p.statuses = p.statuses[1:]
	}
	for k, v := range p.headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
}

func newRelay(url string) (*Relay, *[]time.Duration) {
	var slept []time.Duration
	return &Relay{URL: url, Secret: secret, Clock: &clock.Fake{T: now}, Sleep: func(d time.Duration) { slept = append(slept, d) },
		Rand: rand.New(rand.NewSource(7)), Max: 3, Base: 100 * time.Millisecond, Cap: time.Second}, &slept
}

func rec(id string) store.Record {
	return store.Record{ID: id, EventType: "invoice.paid", ReceivedAt: now, Status: "queued",
		Body: json.RawMessage(`{"id":"` + id + `","type":"invoice.paid","payload":{"invoice_id":"in_1"}}`)}
}

func TestForwardDeliversTheStoredBytesSigned(t *testing.T) {
	p := &partner{statuses: []int{200}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	r, slept := newRelay(srv.URL)
	if err := r.Forward(context.Background(), rec("evt_1")); err != nil {
		t.Fatal(err)
	}
	if len(p.bodies) != 1 || string(p.bodies[0]) != string(rec("evt_1").Body) || len(*slept) != 0 {
		t.Fatalf("bodies %q, slept %v", p.bodies, *slept)
	}
}

func TestForwardRetries429(t *testing.T) {
	p := &partner{statuses: []int{429, 429, 202}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	r, slept := newRelay(srv.URL)
	if err := r.Forward(context.Background(), rec("evt_1")); err != nil {
		t.Fatal(err)
	}
	if len(*slept) != 2 {
		t.Fatalf("slept %v", *slept)
	}
}

func TestForwardHonoursRetryAfter(t *testing.T) {
	p := &partner{statuses: []int{429, 200}, headers: map[string]string{"Retry-After": "3"}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	r, slept := newRelay(srv.URL)
	if err := r.Forward(context.Background(), rec("evt_1")); err != nil {
		t.Fatal(err)
	}
	if len(*slept) != 1 || (*slept)[0] != 3*time.Second {
		t.Fatalf("slept %v", *slept)
	}
}

func TestForwardGivesUp(t *testing.T) {
	p := &partner{statuses: []int{429}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	r, _ := newRelay(srv.URL)
	if err := r.Forward(context.Background(), rec("evt_1")); !errors.Is(err, ErrExhausted) {
		t.Fatalf("err = %v", err)
	}
	if len(p.bodies) != r.Max+1 {
		t.Fatalf("%d attempts for Max %d", len(p.bodies), r.Max)
	}
}

func TestForwardReportsOtherStatuses(t *testing.T) {
	p := &partner{statuses: []int{500}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	r, _ := newRelay(srv.URL)
	var se *StatusError
	if err := r.Forward(context.Background(), rec("evt_1")); !errors.As(err, &se) || se.Code != 500 {
		t.Fatalf("err = %v", err)
	}
}

func TestBackoffStaysWithinItsCeiling(t *testing.T) {
	r, _ := newRelay("http://unused")
	for attempt := 0; attempt < 12; attempt++ {
		ceiling := r.Base << attempt
		if ceiling > r.Cap {
			ceiling = r.Cap
		}
		for i := 0; i < 50; i++ {
			if d := r.backoff(attempt, 0); d < 0 || d > ceiling {
				t.Fatalf("attempt %d: %v outside [0, %v]", attempt, d, ceiling)
			}
		}
	}
	if d := r.backoff(4, 2*time.Second); d != 2*time.Second {
		t.Fatalf("Retry-After ignored: %v", d)
	}
}

func TestNewHTTPClient(t *testing.T) {
	c := NewHTTPClient()
	tr, ok := c.Transport.(*http.Transport)
	if !ok || c.Timeout != 10*time.Second || tr.IdleConnTimeout != 25*time.Second {
		t.Fatalf("client %+v", c)
	}
}

func TestRunRecordsTheOutcome(t *testing.T) {
	p := &partner{statuses: []int{200, 500}}
	srv := httptest.NewServer(p)
	defer srv.Close()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, _ := newRelay(srv.URL)
	q := make(chan store.Record, 2)
	q <- rec("evt_ok")
	q <- rec("evt_bad")
	close(q)
	r.Run(context.Background(), q, st)
	if got, _ := st.Get("evt_ok"); got.Status != "delivered" {
		t.Errorf("evt_ok = %+v", got)
	}
	if got, _ := st.Get("evt_bad"); got.Status != "failed" || got.LastError == "" {
		t.Errorf("evt_bad = %+v", got)
	}
}
