# Windows desktop app

## Building

Requirements (build machine only; end users need nothing): Go 1.26+, Node.js 22+, the Wails CLI v2 and NSIS.

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
winget install NSIS.NSIS
cd desktop
wails build -clean -nsis -trimpath -ldflags "-X main.version=0.1.0 -X main.UpdateRepo=owner/VaultDock"
```

Outputs in `desktop/build/bin/`:

- `VaultDock.exe`: the application.
- `VaultDock-<version>-amd64-setup.exe`: per-user installer (no admin rights). It installs WebView2 if missing, creates Start menu and desktop shortcuts, and registers an uninstaller.

Version: set `info.productVersion` in `desktop/wails.json` and `-X main.version`. For releases, sign both executables (hooks are in `build/windows/installer/project.nsi`).

## Behaviour

- Runs in the notification area; closing the window keeps it syncing (configurable). Tray menu: open, sync all now, pause/resume, open web interface, quit.
- **Start with Windows** (default on after connecting) adds `HKCU\...\Run\VaultDock` with `--minimized`.
- Single instance: launching it again shows the existing window.
- Settings: parallel transfers (automatic with an upper limit, or fixed), bandwidth limit, notifications.

## Data on the PC

| Path | Contents |
|---|---|
| `%APPDATA%\VaultDock\settings.json` | Server URL, pinned certificate, device id, preferences (no secrets) |
| `%APPDATA%\VaultDock\device.key` | Ed25519 private key encrypted with DPAPI for the current Windows user |
| `%APPDATA%\VaultDock\state.db` | Sync configurations, file index, persistent upload queue, history |
| `%LOCALAPPDATA%\VaultDock\logs\` | JSON logs, rotated at 10 MB (3 kept) |

Uninstalling asks whether to remove these; your own files and everything on the server are never touched.

## Updates

**Settings → Check for updates** queries the GitHub releases of the repository compiled in with `-X main.UpdateRepo=owner/name` (disabled while it is the placeholder). When a newer version exists the app opens the release page; running the new installer upgrades in place and keeps settings, the device key and sync state. The app never downloads or runs code on its own.

## Connecting to different servers

The server URL is entered on first run; nothing is hardcoded. Disconnect (Settings) removes the device key; connecting to a different server or account resets the local upload index so files are evaluated again for the new destination.
