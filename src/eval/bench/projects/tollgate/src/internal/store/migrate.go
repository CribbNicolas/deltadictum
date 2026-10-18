package store

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"tollgate/internal/fsx"
)

type line = map[string]json.RawMessage

// steps[v] upgrades the lines of a format v log to format v+1.
var steps = map[int]func([]line){
	1: func(lines []line) {
		for _, l := range lines {
			if _, ok := l["event_type"]; !ok {
				l["event_type"] = json.RawMessage(`"unknown"`)
			}
		}
	},
	2: func(lines []line) {
		for _, l := range lines {
			if string(l["status"]) == `"ok"` {
				l["status"] = json.RawMessage(`"delivered"`)
			}
		}
	},
}

// Migrate rewrites the delivery log in dir in the current format.
func Migrate(dir string) error {
	path := filepath.Join(dir, logName)
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64*1024), 16<<20)
	if !sc.Scan() {
		return fmt.Errorf("%w: empty log", ErrFormat)
	}
	var h header
	if err := json.Unmarshal(sc.Bytes(), &h); err != nil || h.Format < 1 || h.Format > FormatVersion {
		return fmt.Errorf("%w: %d", ErrFormat, h.Format)
	}
	if h.Format == FormatVersion {
		return nil
	}
	var lines []line
	for sc.Scan() {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			continue
		}
		l := line{}
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			return fmt.Errorf("store: bad line: %w", err)
		}
		lines = append(lines, l)
	}
	if err := sc.Err(); err != nil {
		return err
	}
	for v := h.Format; v < FormatVersion; v++ {
		steps[v](lines)
	}
	var out bytes.Buffer
	head, _ := json.Marshal(header{Format: FormatVersion})
	out.Write(append(head, '\n'))
	for _, l := range lines {
		b, err := json.Marshal(l)
		if err != nil {
			return err
		}
		out.Write(append(b, '\n'))
	}
	tmp := path + ".migrate"
	if err := os.WriteFile(tmp, out.Bytes(), 0o644); err != nil {
		return err
	}
	return fsx.ReplaceFile(tmp, path)
}
