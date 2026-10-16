// Package logx writes one key=value line per log record.
package logx

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
)

// Logger writes records to an io.Writer. A nil *Logger discards everything.
type Logger struct {
	mu sync.Mutex
	w  io.Writer
}

// New returns a Logger writing to w.
func New(w io.Writer) *Logger { return &Logger{w: w} }

// Default returns a Logger writing to standard error.
func Default() *Logger { return New(os.Stderr) }

// Info logs at level info; kv holds alternating keys and values.
func (l *Logger) Info(msg string, kv ...any) { l.write("info", msg, kv) }

// Warn logs at level warn.
func (l *Logger) Warn(msg string, kv ...any) { l.write("warn", msg, kv) }

// Error logs at level error.
func (l *Logger) Error(msg string, kv ...any) { l.write("error", msg, kv) }

func (l *Logger) write(level, msg string, kv []any) {
	if l == nil {
		return
	}
	var b strings.Builder
	fmt.Fprintf(&b, "level=%s msg=%q", level, msg)
	for i := 0; i+1 < len(kv); i += 2 {
		fmt.Fprintf(&b, " %v=%s", kv[i], value(kv[i+1]))
	}
	b.WriteByte('\n')
	l.mu.Lock()
	defer l.mu.Unlock()
	io.WriteString(l.w, b.String())
}

func value(v any) string {
	s := fmt.Sprint(v)
	if s == "" || strings.ContainsAny(s, " \t\"=") {
		return strconv.Quote(s)
	}
	return s
}
