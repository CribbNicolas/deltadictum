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

	"tollgate/internal/sign"
	"tollgate/internal/store"
)

const benchStored = `{"type": "invoice.paid", "id": "evt_replay", "payload": {"invoice_id": "in_7"}}`

// benchReplay replays a stored delivery to a partner that records what it receives.
func benchReplay(t *testing.T) (body []byte, signature string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		signature = r.Header.Get("X-Meridian-Signature")
	}))
	defer srv.Close()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	st.Append(store.Record{ID: "evt_replay", EventType: "invoice.paid", ReceivedAt: time.Now().UTC(), Status: "failed", Body: json.RawMessage(benchStored)})
	st.Close()
	cfg := filepath.Join(dir, "config.json")
	b, _ := json.Marshal(map[string]any{"partner_url": srv.URL, "store_dir": filepath.Join(dir, "data"), "secret_env": "TOLLGATE_BENCH_SECRET"})
	os.WriteFile(cfg, b, 0o644)
	t.Setenv("TOLLGATE_BENCH_SECRET", "whsec_bench")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"replay", "-config", cfg, "evt_replay"}, &stdout, &stderr); code != 0 {
		t.Logf("replay exit %d: %s", code, stderr.String())
	}
	return body, signature
}

func TestBenchReplaySignatureVerifies(t *testing.T) {
	body, sig := benchReplay(t)
	if err := sign.VerifyV2([]byte("whsec_bench"), body, sig, time.Now(), 5*time.Minute); err != nil {
		t.Fatalf("the signature does not verify over the bytes received: %v", err)
	}
}

// The log keeps the body compacted (json.RawMessage marshals compact), keys in their original order.
func TestBenchReplaySendsStoredBytes(t *testing.T) {
	var stored bytes.Buffer
	json.Compact(&stored, []byte(benchStored))
	if body, _ := benchReplay(t); string(body) != stored.String() {
		t.Fatalf("sent %s, stored %s", body, stored.String())
	}
}
