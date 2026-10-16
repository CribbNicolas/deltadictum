package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"tollgate/internal/fsx"
)

// Compact rewrites the delivery log in dir with the latest line of each delivery,
// dropping delivered ones received more than 30 days before now.
func Compact(dir string, now time.Time) error {
	s, err := Open(dir)
	if err != nil {
		return err
	}
	records := s.List()
	if err := s.Close(); err != nil {
		return err
	}
	var out bytes.Buffer
	head, _ := json.Marshal(header{Format: FormatVersion})
	out.Write(append(head, '\n'))
	for _, r := range records {
		if r.Status == "delivered" && now.Sub(r.ReceivedAt) > 30*24*time.Hour {
			continue
		}
		line, err := json.Marshal(r)
		if err != nil {
			return err
		}
		out.Write(append(line, '\n'))
	}
	path := filepath.Join(dir, logName)
	tmp := path + ".compact"
	if err := os.WriteFile(tmp, out.Bytes(), 0o644); err != nil {
		return err
	}
	return fsx.ReplaceFile(tmp, path)
}
