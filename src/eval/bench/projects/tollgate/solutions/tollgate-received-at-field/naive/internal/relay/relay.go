// Package relay forwards stored deliveries to Meridian.
package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/logx"
	"tollgate/internal/sign"
	"tollgate/internal/store"
)

// ErrExhausted reports a delivery still refused after every retry.
var ErrExhausted = errors.New("relay: retries exhausted")

// StatusError is a response Meridian gave that is neither success nor a retry.
type StatusError struct {
	Code int
}

func (e *StatusError) Error() string { return fmt.Sprintf("relay: status %d", e.Code) }

// Relay sends deliveries to the partner endpoint.
type Relay struct {
	Client *http.Client
	URL    string
	Secret []byte
	Clock  clock.Clock
	Sleep  func(time.Duration)
	Rand   *rand.Rand
	Max    int
	Base   time.Duration
	Cap    time.Duration
	Log    *logx.Logger
}

// Forward sends rec's stored body with the time tollgate received it, signed, and retries while Meridian answers 429.
func (r *Relay) Forward(ctx context.Context, rec store.Record) error {
	body, err := withReceivedAt(rec)
	if err != nil {
		return fmt.Errorf("relay: body of %s: %w", rec.ID, err)
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Meridian-Signature", sign.V2(r.Secret, rec.Body, r.Clock.Now()))
		resp, err := r.client().Do(req)
		if err != nil {
			return fmt.Errorf("relay: forward %s: %w", rec.ID, err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return nil
		case resp.StatusCode == http.StatusTooManyRequests:
			if attempt >= r.Max {
				return fmt.Errorf("%w: %s after %d attempts", ErrExhausted, rec.ID, attempt+1)
			}
			r.sleep(r.backoff(attempt, retryAfter(resp)))
		default:
			return &StatusError{Code: resp.StatusCode}
		}
	}
}

// withReceivedAt is the stored body with tollgate_received_at added.
func withReceivedAt(rec store.Record) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body, &fields); err != nil {
		return nil, err
	}
	at, err := json.Marshal(rec.ReceivedAt.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	fields["tollgate_received_at"] = at
	return json.Marshal(fields)
}

func (r *Relay) client() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return NewHTTPClient()
}

func (r *Relay) sleep(d time.Duration) {
	if r.Sleep != nil {
		r.Sleep(d)
		return
	}
	time.Sleep(d)
}

func retryAfter(resp *http.Response) time.Duration {
	seconds, err := strconv.Atoi(resp.Header.Get("Retry-After"))
	if err != nil || seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}
