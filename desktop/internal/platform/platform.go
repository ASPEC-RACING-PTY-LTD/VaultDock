// Package platform wraps OS-specific facilities: data directories, secure
// secret storage (Windows DPAPI), start-with-Windows and device identity.
package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
)

// DataDir returns %APPDATA%\VaultDock (roaming settings and state).
func DataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "VaultDock")
}

// LogDir returns %LOCALAPPDATA%\VaultDock\logs.
func LogDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = DataDir()
	}
	return filepath.Join(base, "VaultDock", "logs")
}

// DeviceIdentifier returns a stable, app-specific identifier derived from
// the machine id. The raw machine GUID is never sent to the server.
func DeviceIdentifier() string {
	id := machineID()
	if id == "" {
		h, _ := os.Hostname()
		id = h
	}
	s := sha256.Sum256([]byte("vaultdock-device:" + id))
	return "win-" + hex.EncodeToString(s[:12])
}

// DeviceName returns the computer name.
func DeviceName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "Windows PC"
	}
	return h
}

// OSDescription returns e.g. "Windows 11 Pro 24H2 (build 26100)".
func OSDescription() string {
	if d := osDescription(); d != "" {
		return d
	}
	return runtime.GOOS + "/" + runtime.GOARCH
}

// Protect encrypts data for the current user (DPAPI on Windows).
func Protect(data []byte) ([]byte, error) { return protect(data) }

// Unprotect decrypts data produced by Protect.
func Unprotect(data []byte) ([]byte, error) { return unprotect(data) }

// SetAutoStart enables or disables starting with Windows.
func SetAutoStart(enabled bool) error { return setAutoStart(enabled) }

// AutoStartEnabled reports the current autostart state.
func AutoStartEnabled() bool { return autoStartEnabled() }
