// Package redact masks personal fields in event payloads.
package redact

var sensitive = map[string]bool{"email": true, "card_last4": true, "phone": true}

// Payload returns a copy of m with every sensitive field masked, at any depth.
func Payload(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if sensitive[k] {
			out[k] = "[redacted]"
			continue
		}
		out[k] = value(v)
	}
	return out
}

func value(v any) any {
	switch t := v.(type) {
	case map[string]any:
		return Payload(t)
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = value(item)
		}
		return out
	default:
		return v
	}
}
