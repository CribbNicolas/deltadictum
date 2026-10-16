package sign

import (
	"errors"
	"strings"
	"testing"
	"time"
)

var (
	secret = []byte("whsec_test")
	body   = []byte(`{"id":"evt_1","type":"invoice.paid"}`)
	at     = time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
)

func TestV2HasTimestampAndHex(t *testing.T) {
	h := V2(secret, body, at)
	if !strings.HasPrefix(h, "t=1772600767,v1=") || len(h) != len("t=1772600767,v1=")+64 {
		t.Fatalf("V2() = %q", h)
	}
}

func TestVerifyV2(t *testing.T) {
	h := V2(secret, body, at)
	if err := VerifyV2(secret, body, h, at.Add(time.Minute), 5*time.Minute); err != nil {
		t.Fatalf("valid signature refused: %v", err)
	}
	if err := VerifyV2(secret, append([]byte(" "), body...), h, at, 5*time.Minute); !errors.Is(err, ErrSignature) {
		t.Fatalf("changed body: err = %v, want ErrSignature", err)
	}
	if err := VerifyV2(secret, body, h, at.Add(10*time.Minute), 5*time.Minute); !errors.Is(err, ErrTimestamp) {
		t.Fatalf("old timestamp: err = %v, want ErrTimestamp", err)
	}
	if err := VerifyV2(secret, body, "v1=abc", at, 5*time.Minute); !errors.Is(err, ErrSignature) {
		t.Fatalf("malformed header: err = %v, want ErrSignature", err)
	}
}

func TestV1(t *testing.T) {
	h := V1(secret, body)
	if !strings.HasPrefix(h, "sha256=") || len(h) != len("sha256=")+64 {
		t.Fatalf("V1() = %q", h)
	}
	if err := VerifyV1(secret, body, h); err != nil {
		t.Fatalf("VerifyV1: %v", err)
	}
	if err := VerifyV1(secret, []byte("{}"), h); !errors.Is(err, ErrSignature) {
		t.Fatalf("VerifyV1 changed body: %v", err)
	}
}
