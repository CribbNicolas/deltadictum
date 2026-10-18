package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tollgate/internal/intake"
)

func TestBenchHealthz(t *testing.T) {
	mux := newMux(&intake.Handler{})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "ok" {
		t.Fatalf("GET /healthz: %d %q", rec.Code, rec.Body.String())
	}
}
