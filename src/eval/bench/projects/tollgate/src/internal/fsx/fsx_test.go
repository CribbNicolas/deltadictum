package fsx

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplaceFileOverAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "state.json")
	tmp := dst + ".tmp"
	if err := os.WriteFile(dst, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tmp, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ReplaceFile(tmp, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != "new" {
		t.Fatalf("dst = %q, %v", got, err)
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatalf("tmp still there: %v", err)
	}
}
