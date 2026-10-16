package relay

import (
	"net/http"
	"time"
)

// NewHTTPClient returns the client tollgate uses for Meridian.
func NewHTTPClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.IdleConnTimeout = 25 * time.Second
	return &http.Client{Timeout: 10 * time.Second, Transport: t}
}
