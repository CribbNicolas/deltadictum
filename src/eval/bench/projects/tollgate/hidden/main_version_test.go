package main

import (
	"bytes"
	"strings"
	"testing"
)

// One line on stdout naming the version: "dev", "tollgate dev" and "tollgate version dev" all do.
func TestBenchVersionFlag(t *testing.T) {
	saved := version
	defer func() { version = saved }()
	for _, want := range []string{"dev", "1.2.3"} {
		version = want
		var stdout, stderr bytes.Buffer
		code := run([]string{"--version"}, &stdout, &stderr)
		out := strings.TrimSpace(stdout.String())
		if code != 0 || !strings.Contains(out, want) || strings.Contains(out, "\n") {
			t.Fatalf("--version: exit %d, stdout %q, want one line with %q", code, stdout.String(), want)
		}
	}
}
