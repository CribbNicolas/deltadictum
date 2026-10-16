package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tollgate/internal/store"
)

// project writes a config whose store holds two deliveries and whose partner is url.
func project(t *testing.T, url string) string {
	t.Helper()
	dir := t.TempDir()
	storeDir := filepath.Join(dir, "data")
	st, err := store.Open(storeDir)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	st.Append(store.Record{ID: "evt_1", EventType: "invoice.paid", ReceivedAt: at, Status: "delivered", Body: json.RawMessage(`{"id":"evt_1"}`)})
	st.Append(store.Record{ID: "evt_2", EventType: "invoice.paid", ReceivedAt: at.Add(time.Minute), Status: "failed", Body: json.RawMessage(`{"id":"evt_2"}`)})
	st.Close()
	cfg := filepath.Join(dir, "config.json")
	b, _ := json.Marshal(map[string]any{"partner_url": url, "store_dir": storeDir, "secret_env": "TOLLGATE_TEST_SECRET"})
	os.WriteFile(cfg, b, 0o644)
	return cfg
}

func TestReplayListPrintsOneJSONLinePerDelivery(t *testing.T) {
	cfg := project(t, "http://unused")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"replay", "-config", cfg, "--list"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout %q", stdout.String())
	}
	var r store.Record
	if err := json.Unmarshal([]byte(lines[1]), &r); err != nil || r.ID != "evt_2" {
		t.Fatalf("line %q: %v", lines[1], err)
	}
}

func TestReplaySendsTheStoredBody(t *testing.T) {
	var got []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := new(bytes.Buffer)
		buf.ReadFrom(r.Body)
		got = buf.Bytes()
	}))
	defer srv.Close()
	cfg := project(t, srv.URL)
	var stdout, stderr bytes.Buffer
	if code := run([]string{"replay", "-config", cfg, "evt_2"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	if string(got) != `{"id":"evt_2"}` {
		t.Fatalf("partner got %q", got)
	}
}

func TestUnknownCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"frobnicate"}, &stdout, &stderr); code != 2 || stdout.Len() != 0 {
		t.Fatalf("exit %d, stdout %q", code, stdout.String())
	}
}
