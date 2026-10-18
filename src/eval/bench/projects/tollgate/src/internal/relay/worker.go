package relay

import (
	"context"

	"tollgate/internal/store"
)

// Run forwards every delivery from queue until it closes or ctx ends, and records each outcome.
func (r *Relay) Run(ctx context.Context, queue <-chan store.Record, st *store.Store) {
	for {
		select {
		case <-ctx.Done():
			return
		case rec, ok := <-queue:
			if !ok {
				return
			}
			if err := r.Forward(ctx, rec); err != nil {
				rec.Status, rec.LastError = "failed", err.Error()
				r.Log.Warn("delivery failed", "event_id", rec.ID, "err", err)
			} else {
				rec.Status, rec.LastError = "delivered", ""
			}
			if err := st.Append(rec); err != nil {
				r.Log.Error("store append failed", "event_id", rec.ID, "err", err)
			}
		}
	}
}
