package logx

import (
	"bytes"
	"strings"
	"testing"
)

func TestLinesCarryLevelMessageAndPairs(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf)
	l.Info("started", "listen", ":8080")
	l.Warn("queue full", "event_id", "evt_1", "depth", 1024)
	l.Error("forward failed", "reason", "connection reset by peer")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	want := []string{
		`level=info msg="started" listen=:8080`,
		`level=warn msg="queue full" event_id=evt_1 depth=1024`,
		`level=error msg="forward failed" reason="connection reset by peer"`,
	}
	if len(lines) != len(want) {
		t.Fatalf("got %d lines: %q", len(lines), lines)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("line %d = %q, want %q", i, lines[i], want[i])
		}
	}
}

func TestNilLoggerIsQuiet(t *testing.T) {
	var l *Logger
	l.Warn("ignored")
}
