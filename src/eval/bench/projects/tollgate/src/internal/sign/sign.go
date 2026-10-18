// Package sign computes and verifies the HMAC signatures on requests to Meridian.
package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	// ErrSignature reports a missing, malformed or wrong signature.
	ErrSignature = errors.New("sign: invalid signature")
	// ErrTimestamp reports a signature time outside the allowed skew.
	ErrTimestamp = errors.New("sign: timestamp outside tolerance")
)

// V2 signs body at time t: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<unix>." + body>".
func V2(secret, body []byte, t time.Time) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	return "t=" + ts + ",v1=" + mac(secret, []byte(ts), []byte("."), body)
}

// VerifyV2 checks a V2 header against body at now, allowing skew either way.
func VerifyV2(secret, body []byte, header string, now time.Time, skew time.Duration) error {
	var ts, sum string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(part, "=")
		switch key {
		case "t":
			ts = value
		case "v1":
			sum = value
		}
	}
	unix, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || sum == "" {
		return ErrSignature
	}
	if d := now.Sub(time.Unix(unix, 0)); d > skew || d < -skew {
		return ErrTimestamp
	}
	if !hmac.Equal([]byte(sum), []byte(mac(secret, []byte(ts), []byte("."), body))) {
		return ErrSignature
	}
	return nil
}

// V1 is the original signing scheme: "sha256=<hex HMAC-SHA256 of body>".
func V1(secret, body []byte) string { return "sha256=" + mac(secret, body) }

// VerifyV1 checks a V1 header against body.
func VerifyV1(secret, body []byte, header string) error {
	sum, ok := strings.CutPrefix(header, "sha256=")
	if !ok || !hmac.Equal([]byte(sum), []byte(mac(secret, body))) {
		return ErrSignature
	}
	return nil
}

func mac(secret []byte, parts ...[]byte) string {
	h := hmac.New(sha256.New, secret)
	for _, p := range parts {
		h.Write(p)
	}
	return hex.EncodeToString(h.Sum(nil))
}
