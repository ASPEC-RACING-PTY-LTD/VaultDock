package main

import (
	"html"
	"log/slog"
	"os"
	"path/filepath"

	"git.sr.ht/~jackmordaunt/go-toast/v2/wintoast"
)

const appUserModelID = "VaultDock.Desktop"

// toasts shows Windows notifications through the WinRT COM API only. The
// library's PowerShell fallback is deliberately never enabled: it embeds
// text in a script, and notification text can contain file names.
type toasts struct {
	log *slog.Logger
	ok  bool
}

func newToasts(log *slog.Logger) *toasts {
	exe, _ := os.Executable()
	icon := filepath.Join(filepath.Dir(exe), "appicon.png")
	if _, err := os.Stat(icon); err != nil {
		icon = ""
	}
	err := wintoast.SetAppData(wintoast.AppData{AppID: appUserModelID, GUID: "{6B0C3A57-2E43-4C58-9C0F-3A9E8D1F4B21}", ActivationExe: exe, IconPath: icon})
	if err != nil {
		log.Warn("notifications unavailable", "err", err)
	}
	return &toasts{log: log, ok: err == nil}
}

func (t *toasts) Show(title, message, level string) {
	if !t.ok {
		return
	}
	xml := `<toast><visual><binding template="ToastGeneric"><text>` + html.EscapeString(title) + `</text><text>` + html.EscapeString(message) + `</text></binding></visual></toast>`
	if err := wintoast.Push(appUserModelID, xml); err != nil {
		t.log.Debug("toast failed", "err", err)
	}
}
