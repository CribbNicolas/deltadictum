package relay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/sign"
	"tollgate/internal/store"
)

func TestForwardSignedAtClockTime(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	var verr error
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		verr = sign.VerifyV2([]byte("whsec_clock"), body, r.Header.Get("X-Meridian-Signature"), at, 24*time.Hour*3650)
	}))
	defer srv.Close()
	r := &Relay{URL: srv.URL, Secret: []byte("whsec_clock"), Clock: &clock.Fake{T: at}, Max: 1, Base: time.Millisecond, Cap: time.Millisecond}
	if err := r.Forward(context.Background(), store.Record{ID: "evt_clock", Body: json.RawMessage(`{"id":"evt_clock"}`)}); err != nil {
		t.Fatal(err)
	}
	if verr != nil {
		t.Fatalf("signature at the relay clock: %v", verr)
	}
}
