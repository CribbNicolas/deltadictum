package redact

import (
	"reflect"
	"testing"
)

func TestPayloadMasksSensitiveFieldsAtAnyDepth(t *testing.T) {
	in := map[string]any{
		"customer_id": "cus_1",
		"email":       "ana@example.com",
		"billing": map[string]any{
			"phone":      "+47 900 00 000",
			"card_last4": "4242",
			"city":       "Bergen",
		},
		"contacts": []any{map[string]any{"email": "ops@example.com", "role": "ops"}},
	}
	got := Payload(in)
	want := map[string]any{
		"customer_id": "cus_1",
		"email":       "[redacted]",
		"billing": map[string]any{
			"phone":      "[redacted]",
			"card_last4": "[redacted]",
			"city":       "Bergen",
		},
		"contacts": []any{map[string]any{"email": "[redacted]", "role": "ops"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Payload() = %v, want %v", got, want)
	}
	if in["email"] != "ana@example.com" {
		t.Fatal("Payload changed its input")
	}
}
