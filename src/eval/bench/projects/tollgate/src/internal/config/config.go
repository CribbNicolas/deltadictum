// Package config loads tollgate's configuration file.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// Retry bounds the relay's retries.
type Retry struct {
	Max    int `json:"max"`
	BaseMS int `json:"base_ms"`
	CapMS  int `json:"cap_ms"`
}

// Config is tollgate's configuration.
type Config struct {
	Listen     string `json:"listen"`
	PartnerURL string `json:"partner_url"`
	SecretEnv  string `json:"secret_env"`
	StoreDir   string `json:"store_dir"`
	Retry      Retry  `json:"retry"`
}

// Default returns the configuration used for every field a file leaves out.
func Default() Config {
	return Config{Listen: ":8080", SecretEnv: "TOLLGATE_SECRET", StoreDir: "data", Retry: Retry{Max: 8, BaseMS: 500, CapMS: 30000}}
}

// Load reads the JSON file at path over the defaults.
func Load(path string) (Config, error) {
	c := Default()
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("config: %s: %w", path, err)
	}
	if c.PartnerURL == "" {
		return c, errors.New("config: partner_url is required")
	}
	return c, nil
}
