package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"tollgate/internal/jsonx"
	"tollgate/internal/sign"
	"tollgate/internal/store"
)

type notification struct {
	DeliveryID string `json:"delivery_id"`
	Status     string `json:"status"`
	EventType  string `json:"event_type"`
}

// Notify tells Meridian that a delivery reached its final status.
func (r *Relay) Notify(ctx context.Context, rec store.Record) error {
	n := notification{DeliveryID: rec.ID, Status: rec.Status, EventType: rec.EventType}
	signed, err := jsonx.Canonical(n)
	if err != nil {
		return err
	}
	body, err := json.Marshal(n)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL+"/notifications", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Meridian-Signature", sign.V2(r.Secret, signed, r.Clock.Now()))
	resp, err := r.client().Do(req)
	if err != nil {
		return fmt.Errorf("relay: notify %s: %w", rec.ID, err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return &StatusError{Code: resp.StatusCode}
	}
	return nil
}
