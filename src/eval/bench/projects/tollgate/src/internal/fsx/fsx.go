// Package fsx holds file system helpers.
package fsx

import (
	"os"
	"runtime"
	"time"
)

// ReplaceFile moves tmp over dst.
func ReplaceFile(tmp, dst string) error {
	var err error
	for i := 0; i < 10; i++ {
		if err = os.Rename(tmp, dst); err == nil {
			return nil
		}
		if runtime.GOOS != "windows" {
			return err
		}
		os.Remove(dst)
		time.Sleep(50 * time.Millisecond)
	}
	return err
}
