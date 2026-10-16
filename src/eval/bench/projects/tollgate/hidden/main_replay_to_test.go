package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"tollgate/internal/store"
)

func TestBenchReplayTo(t *testing.T) {
	var got []byte
	staging := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got, _ = io.ReadAll(r.Body) }))
	defer staging.Close()
	partner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("the replay went to the configured partner instead of --to")
	}))
	defer partner.Close()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	st.Append(store.Record{ID: "evt_to", EventType: "invoice.paid", ReceivedAt: time.Now().UTC(), Status: "failed", Body: json.RawMessage(`{"id":"evt_to"}`)})
	st.Close()
	cfg := filepath.Join(dir, "config.json")
	b, _ := json.Marshal(map[string]any{"partner_url": partner.URL, "store_dir": filepath.Join(dir, "data")})
	os.WriteFile(cfg, b, 0o644)
	var stdout, stderr bytes.Buffer
	if code := run([]string{"replay", "-config", cfg, "--to", staging.URL, "evt_to"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	if string(got) != `{"id":"evt_to"}` {
		t.Fatalf("staging got %q", got)
	}
}
