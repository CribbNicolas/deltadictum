// Package jsonx holds JSON helpers shared by intake and relay.
package jsonx

import (
	"bytes"
	"encoding/json"
)

// Canonical returns stable bytes for v, for hashing and comparisons: object keys
// sorted at every level and no insignificant spaces. A []byte or json.RawMessage
// is read as a JSON document.
func Canonical(v any) ([]byte, error) {
	var raw []byte
	switch t := v.(type) {
	case []byte:
		raw = t
	case json.RawMessage:
		raw = t
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var doc any
	if err := dec.Decode(&doc); err != nil {
		return nil, err
	}
	return json.Marshal(doc)
}
