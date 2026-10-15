// Package storage manages blob files on configured storage locations.
//
// Layout of a location directory:
//
//	<location>/.vaultdock-location   marker file
//	<location>/blobs/<user>/<aa>/<bb>/<sha256>   content-addressed blobs
//	<location>/tmp/<upload-id>.part              in-progress uploads
//
// Blob paths are derived only from numeric user ids and validated hex
// hashes, so client-supplied names never reach the filesystem.
package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/vaultdock/vaultdock/internal/store"
)

var (
	ErrInsufficientStorage = errors.New("not enough free space on the storage device")
	ErrLocationUnavailable = errors.New("storage location is unavailable")
	ErrHashMismatch        = errors.New("content hash does not match")
)

var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var uploadIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

// ValidSHA256 reports whether s is a lower-case hex SHA-256.
func ValidSHA256(s string) bool { return shaPattern.MatchString(s) }

// ValidUploadID reports whether s is a well-formed upload id.
func ValidUploadID(s string) bool { return uploadIDPattern.MatchString(s) }

const markerFile = ".vaultdock-location"

// Manager handles blob placement, reads and deletion.
type Manager struct {
	st    *store.Store
	locks [256]sync.Mutex
	mu    sync.RWMutex
	locs  map[int64]store.Location
	// GlobalMinFree is a hard floor of free bytes kept on every device.
	GlobalMinFree int64
}

func New(st *store.Store) *Manager {
	return &Manager{st: st, locs: map[int64]store.Location{}, GlobalMinFree: 1 << 30}
}

// Reload refreshes the location cache from the database.
func (m *Manager) Reload(ctx context.Context) error {
	list, err := m.st.ListLocations(ctx)
	if err != nil {
		return err
	}
	locs := map[int64]store.Location{}
	for _, l := range list {
		locs[l.ID] = l
	}
	m.mu.Lock()
	m.locs = locs
	m.mu.Unlock()
	return nil
}

// Location returns a cached location.
func (m *Manager) Location(id int64) (store.Location, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	l, ok := m.locs[id]
	return l, ok
}

// PrepareLocation creates the directory layout and verifies the path is a
// writable directory.
func PrepareLocation(path string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("storage path must be absolute")
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("storage path %s does not exist; create or mount it first", path)
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("storage path %s is not a directory", path)
	}
	for _, d := range []string{"blobs", "tmp"} {
		if err := os.MkdirAll(filepath.Join(path, d), 0o750); err != nil {
			return fmt.Errorf("cannot create %s in %s: %w", d, path, err)
		}
	}
	probe := filepath.Join(path, "tmp", ".write-test-"+strconv.FormatInt(time.Now().UnixNano(), 36))
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("storage path %s is not writable: %w", path, err)
	}
	_ = os.Remove(probe)
	marker := filepath.Join(path, markerFile)
	if _, err := os.Stat(marker); os.IsNotExist(err) {
		_ = os.WriteFile(marker, []byte("VaultDock storage location. Do not delete files in this directory manually.\n"), 0o640)
	}
	return nil
}

// LocationHealthy checks that the location directory is still mounted
// (marker present), so a missing mount is never mistaken for empty storage.
func LocationHealthy(path string) error {
	if _, err := os.Stat(filepath.Join(path, markerFile)); err != nil {
		return fmt.Errorf("%w: %s (marker missing; is the volume mounted?)", ErrLocationUnavailable, path)
	}
	return nil
}

func (m *Manager) lock(userID int64, sha string) func() {
	h := fnv.New32a()
	h.Write([]byte(sha))
	h.Write([]byte(strconv.FormatInt(userID, 10)))
	mu := &m.locks[h.Sum32()%256]
	mu.Lock()
	return mu.Unlock
}

func (m *Manager) loc(id int64) (store.Location, error) {
	l, ok := m.Location(id)
	if !ok {
		if err := m.Reload(context.Background()); err == nil {
			l, ok = m.Location(id)
		}
	}
	if !ok {
		return l, ErrLocationUnavailable
	}
	return l, nil
}

// BlobPath returns the on-disk path for a blob.
func (m *Manager) BlobPath(locID, userID int64, sha string) (string, error) {
	if !ValidSHA256(sha) {
		return "", errors.New("invalid hash")
	}
	l, err := m.loc(locID)
	if err != nil {
		return "", err
	}
	return filepath.Join(l.Path, "blobs", strconv.FormatInt(userID, 10), sha[0:2], sha[2:4], sha), nil
}

// TempPath returns the path for an upload's partial file.
func (m *Manager) TempPath(locID int64, uploadID string) (string, error) {
	if !ValidUploadID(uploadID) {
		return "", errors.New("invalid upload id")
	}
	l, err := m.loc(locID)
	if err != nil {
		return "", err
	}
	return filepath.Join(l.Path, "tmp", uploadID+".part"), nil
}

// Space describes a filesystem's capacity.
type Space struct {
	Total     int64 `json:"total"`
	Free      int64 `json:"free"`
	Available int64 `json:"available"`
}

// DiskSpace returns capacity for the filesystem holding path.
func DiskSpace(path string) (Space, error) { return diskSpace(path) }

// CheckSpace verifies that need more bytes fit on the location while
// keeping its reserve, the global floor and in-flight uploads free.
func (m *Manager) CheckSpace(ctx context.Context, locID int64, need int64) error {
	l, err := m.loc(locID)
	if err != nil {
		return err
	}
	if !l.Enabled {
		return fmt.Errorf("%w: location %q is disabled", ErrLocationUnavailable, l.Name)
	}
	if err := LocationHealthy(l.Path); err != nil {
		return err
	}
	sp, err := DiskSpace(l.Path)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrLocationUnavailable, err)
	}
	pending, err := m.st.PendingBytes(ctx, locID)
	if err != nil {
		return err
	}
	reserve := max(l.ReserveBytes, m.GlobalMinFree)
	if sp.Available-pending-need < reserve {
		return ErrInsufficientStorage
	}
	return nil
}

// Place moves a verified temp file into the blob store under the blob lock
// and runs commit while still holding it. If commit fails and the blob was
// newly created and remains unreferenced, the blob file is removed.
func (m *Manager) Place(ctx context.Context, userID int64, sha, tempPath string, locID int64, commit func(locID int64) error) error {
	unlock := m.lock(userID, sha)
	defer unlock()
	useLoc := locID
	if existing, err := m.st.BlobLocation(ctx, userID, sha); err == nil {
		useLoc = existing
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	dest, err := m.BlobPath(useLoc, userID, sha)
	if err != nil {
		return err
	}
	created := false
	if _, err := os.Stat(dest); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
			return err
		}
		if useLoc == locID {
			if err := os.Rename(tempPath, dest); err != nil {
				return fmt.Errorf("finalise blob: %w", err)
			}
		} else {
			// Existing blob row on another location but the file is missing:
			// copy the verified content there.
			if err := copyFile(tempPath, dest); err != nil {
				return err
			}
			_ = os.Remove(tempPath)
		}
		syncDir(filepath.Dir(dest))
		created = true
	} else if err != nil {
		return err
	} else {
		_ = os.Remove(tempPath)
	}
	if err := commit(useLoc); err != nil {
		if created {
			if ok, _ := m.st.BlobExists(ctx, userID, sha); !ok {
				_ = os.Remove(dest)
			}
		}
		return err
	}
	return nil
}

// LinkExisting runs commit for content the user already stores
// (deduplication) while holding the blob lock.
func (m *Manager) LinkExisting(ctx context.Context, userID int64, sha string, commit func(locID int64) error) (bool, error) {
	unlock := m.lock(userID, sha)
	defer unlock()
	loc, err := m.st.BlobLocation(ctx, userID, sha)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	p, err := m.BlobPath(loc, userID, sha)
	if err != nil {
		return false, err
	}
	if _, err := os.Stat(p); err != nil {
		slog.Warn("blob row exists but file is missing; forcing re-upload", "user", userID, "sha", sha)
		return false, nil
	}
	return true, commit(loc)
}

// Remove deletes blob files whose rows are gone.
func (m *Manager) Remove(ctx context.Context, refs []store.BlobRef) {
	for _, r := range refs {
		func() {
			unlock := m.lock(r.UserID, r.SHA256)
			defer unlock()
			if ok, err := m.st.BlobExists(ctx, r.UserID, r.SHA256); err != nil || ok {
				return
			}
			p, err := m.BlobPath(r.LocationID, r.UserID, r.SHA256)
			if err != nil {
				return
			}
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				slog.Warn("failed to delete blob", "path", p, "err", err)
			}
		}()
	}
}

// Open opens a blob for reading.
func (m *Manager) Open(locID, userID int64, sha string) (*os.File, error) {
	p, err := m.BlobPath(locID, userID, sha)
	if err != nil {
		return nil, err
	}
	return os.Open(p)
}

// HashFile computes the SHA-256 of a file.
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	if _, err := io.CopyBuffer(h, f, buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".copying"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	out.Close()
	return os.Rename(tmp, dst)
}

func syncDir(dir string) {
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		d.Close()
	}
}

// CleanOrphans removes temp files without an open upload and blob files
// without a database row. Files younger than minAge are left alone.
func (m *Manager) CleanOrphans(ctx context.Context, minAge time.Duration) (int, error) {
	if err := m.Reload(ctx); err != nil {
		return 0, err
	}
	m.mu.RLock()
	locs := make([]store.Location, 0, len(m.locs))
	for _, l := range m.locs {
		locs = append(locs, l)
	}
	m.mu.RUnlock()
	removed := 0
	cutoff := time.Now().Add(-minAge)
	for _, l := range locs {
		if LocationHealthy(l.Path) != nil {
			continue
		}
		tmpDir := filepath.Join(l.Path, "tmp")
		entries, _ := os.ReadDir(tmpDir)
		for _, e := range entries {
			name := e.Name()
			info, err := e.Info()
			if err != nil || info.ModTime().After(cutoff) {
				continue
			}
			id := name
			if ext := filepath.Ext(name); ext == ".part" {
				id = name[:len(name)-len(ext)]
			}
			if u, err := m.st.UploadAny(ctx, id); err == nil && (u.Status == "open" || u.Status == "finalizing") {
				continue
			}
			if os.Remove(filepath.Join(tmpDir, name)) == nil {
				removed++
			}
		}
		keys, err := m.st.AllBlobKeys(ctx, l.ID)
		if err != nil {
			return removed, err
		}
		blobRoot := filepath.Join(l.Path, "blobs")
		_ = filepath.WalkDir(blobRoot, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			sha := d.Name()
			if !ValidSHA256(sha) {
				return nil
			}
			rel, _ := filepath.Rel(blobRoot, p)
			parts := splitPath(rel)
			if len(parts) != 4 {
				return nil
			}
			uid, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil {
				return nil
			}
			if keys[store.BlobKey(uid, sha)] {
				return nil
			}
			info, err := d.Info()
			if err != nil || info.ModTime().After(cutoff) {
				return nil
			}
			unlock := m.lock(uid, sha)
			defer unlock()
			if ok, _ := m.st.BlobExists(ctx, uid, sha); ok {
				return nil
			}
			if os.Remove(p) == nil {
				removed++
			}
			return nil
		})
	}
	return removed, nil
}

func splitPath(p string) []string {
	var out []string
	for {
		dir, file := filepath.Split(p)
		if file != "" {
			out = append([]string{file}, out...)
		}
		dir = filepath.Clean(dir)
		if dir == "." || dir == string(filepath.Separator) || dir == p {
			break
		}
		p = dir
	}
	return out
}
