package intake

// audit records every accepted event, for the support team.
func (h *Handler) audit(ev Event) {
	h.Log.Info("event accepted", "event_id", ev.ID, "type", ev.Type, "payload", string(ev.Payload))
}
