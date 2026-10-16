// Package intake accepts webhooks from internal services.
package intake

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/logx"
	"tollgate/internal/redact"
	"tollgate/internal/schema"
	"tollgate/internal/store"
)

const maxBody = 4 << 20

// Event is a webhook as services post it.
type Event struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload"`
}

// Handler serves POST /v1/events.
type Handler struct {
	Store *store.Store
	Dedup *Dedup
	Queue chan<- store.Record
	Clock clock.Clock
	Log   *logx.Logger
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unreadable body"})
		return
	}
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		h.reject(w, "invalid json")
		return
	}
	switch {
	case ev.ID == "":
		h.reject(w, "missing id")
		return
	case len(ev.Payload) == 0:
		h.reject(w, "missing payload")
		return
	}
	if _, ok := schema.Known[ev.Type]; !ok {
		h.logRejected(ev, "unknown event type")
		h.reject(w, "unknown event type")
		return
	}
	now := h.Clock.Now()
	if h.Dedup.Seen(ev.ID, now) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
		return
	}
	rec := store.Record{ID: ev.ID, EventType: ev.Type, ReceivedAt: now, Status: "queued", Body: body}
	if err := h.Store.Append(rec); err != nil {
		h.Log.Error("store append failed", "event_id", ev.ID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store unavailable"})
		return
	}
	select {
	case h.Queue <- rec:
	default:
		h.Log.Warn("queue full, delivery left queued", "event_id", ev.ID)
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (h *Handler) reject(w http.ResponseWriter, reason string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": reason})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// logRejected logs an event intake refused, with its payload.
func (h *Handler) logRejected(ev Event, reason string) {
	var fields map[string]any
	payload := "(unreadable)"
	if json.Unmarshal(ev.Payload, &fields) == nil {
		if b, err := json.Marshal(redact.Payload(fields)); err == nil {
			payload = string(b)
		}
	}
	h.Log.Warn("rejected event", "event_id", ev.ID, "reason", reason, "payload", payload)
}
