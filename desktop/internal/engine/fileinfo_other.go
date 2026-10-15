//go:build !windows

package engine

import (
	"os"
	"time"
)

func isHidden(fi os.FileInfo) bool { return len(fi.Name()) > 0 && fi.Name()[0] == '.' }

func createdTime(fi os.FileInfo) time.Time { return fi.ModTime() }
