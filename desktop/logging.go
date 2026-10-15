package main

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// rotatingFile is a minimal size-based log rotator (vaultdock.log,
// vaultdock.log.1, ...).
type rotatingFile struct {
	mu   sync.Mutex
	path string
	max  int64
	keep int
	f    *os.File
	size int64
}

func openLog(dir string) (*rotatingFile, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	r := &rotatingFile{path: filepath.Join(dir, "vaultdock.log"), max: 10 << 20, keep: 3}
	return r, r.open()
}

func (r *rotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	st, _ := f.Stat()
	r.f, r.size = f, st.Size()
	return nil
}

func (r *rotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size+int64(len(p)) > r.max {
		r.f.Close()
		for i := r.keep - 1; i >= 1; i-- {
			_ = os.Rename(fmt.Sprintf("%s.%d", r.path, i), fmt.Sprintf("%s.%d", r.path, i+1))
		}
		_ = os.Rename(r.path, r.path+".1")
		if err := r.open(); err != nil {
			return 0, err
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

func newLogger(dir string) (*slog.Logger, io.Closer) {
	rf, err := openLog(dir)
	if err != nil {
		return slog.New(slog.NewTextHandler(os.Stderr, nil)), io.NopCloser(nil)
	}
	return slog.New(slog.NewJSONHandler(rf, &slog.HandlerOptions{Level: slog.LevelInfo})), rf.f
}
