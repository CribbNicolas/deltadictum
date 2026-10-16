package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestBenchVersionFlag(t *testing.T) {
	saved := version
	defer func() { version = saved }()
	for _, want := range []string{"dev", "1.2.3"} {
		if want != "dev" {
			version = want
		}
		var stdout, stderr bytes.Buffer
		if code := run([]string{"--version"}, &stdout, &stderr); code != 0 || strings.TrimSpace(stdout.String()) != want {
			t.Fatalf("--version: exit %d, stdout %q, want %q", code, stdout.String(), want)
		}
	}
}
