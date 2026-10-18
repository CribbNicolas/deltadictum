package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAppliesDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte(`{"partner_url": "https://api.meridian.test/v2/events"}`), 0o644)
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || c.StoreDir != "data" || c.SecretEnv != "TOLLGATE_SECRET" {
		t.Fatalf("defaults not applied: %+v", c)
	}
	if c.Retry != (Retry{Max: 8, BaseMS: 500, CapMS: 30000}) {
		t.Fatalf("retry defaults: %+v", c.Retry)
	}
}

func TestLoadRefusesAMissingPartnerURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte(`{"listen": ":9000"}`), 0o644)
	if _, err := Load(path); err == nil {
		t.Fatal("Load accepted a config without partner_url")
	}
}

func TestExampleConfigLoads(t *testing.T) {
	if _, err := Load(filepath.Join("..", "..", "config.example.json")); err != nil {
		t.Fatal(err)
	}
}
