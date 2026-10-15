# VaultDock

Self-hosted file storage and intelligent synchronisation. Run it on your own hardware, connect your Windows PCs, choose exactly which folders and files to sync, and let visual automations decide where everything goes.

- **Web app**: file browser with previews and streamed video playback, uploads, trash, search and tags, devices, sync overview, activity, and an admin console.
- **Windows desktop app**: tray app that watches the folders you select and uploads changes in the background with resumable, verified, adaptively parallel transfers.
- **Visual automation builder**: node-based workflows (triggers, AND/OR conditions, branches, actions) with JSON import/export, a variable reference, AI-friendly schema docs and dry runs.
- **Secure by design**: HTTPS, device approval, Ed25519 per-device keys stored with Windows DPAPI, signed and replay-protected requests, strict per-user isolation.

> Example use: sync Medal gaming clips into `/Medal/<game>/<year-month>/`, skip temporary recordings, tag them by game, and watch them in the browser.

## Install (Linux server with Docker)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/VaultDock/main/install.sh | bash
```

The installer shows a menu: **1) Install / Replace, 2) Upgrade, 3) Uninstall**. It installs into `~/VaultDock` (or `/root/VaultDock` as root), asks where to store files (point it at your HDD), generates a setup token, builds and starts the container, and waits until it is healthy.

Then open the printed URL, create the administrator with the setup token, and install the desktop app.

### Prefer to inspect first? (recommended)

Piping a script from the internet into a shell runs it with your privileges before you have read it. To review it first:

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/YOUR_GITHUB_USER/VaultDock/main/install.sh
less install.sh
bash install.sh
```

Or clone the repository and run `./install.sh` from it; the installer then uses the local source instead of downloading. Pin a release with `VAULTDOCK_REF=v1.0.0`.

What the installer does and does not do:

- Writes only inside the install directory, plus the storage path you choose.
- Needs Docker Engine with the Compose plugin; it does not install system packages.
- Never deletes stored files, the database or settings unless you choose full uninstall **and** type `DELETE ALL DATA`.
- Upgrades back up the database, `.env` and application first, and roll back automatically if the new version does not become healthy.

Non-interactive use: `VAULTDOCK_YES=1 bash install.sh install` (defaults are used; destructive actions still require a terminal).

## Windows desktop app

Build the installer (see [docs/desktop.md](docs/desktop.md)) or download `VaultDock-<version>-amd64-setup.exe` from a release. It installs per user (no admin rights), bundles everything it needs and installs the WebView2 runtime if missing.

1. Enter your server URL, username and password.
2. The app shows a verification code. In the web interface open **Devices**, check the code, and approve.
3. Add sync folders (presets for Medal clips, screenshots and documents), preview what will upload, and you're done.

The password is used once to request access and is never stored. Revoking a device in the web interface stops it immediately.

## Documentation

| Topic | |
|---|---|
| [Deployment](docs/deployment.md) | Docker, storage disks, HTTPS options, reverse proxies, backups |
| [Upgrade, uninstall & troubleshooting](docs/operations.md) | Day-two operations and common problems |
| [Architecture](docs/architecture.md) | Components, data model, sync engine, adaptive concurrency |
| [Security](docs/security.md) | Threat model, transport, device keys, isolation, end-to-end encryption trade-offs |
| [Automations](docs/automations.md) | Schema, variables, templates and how to generate automations with an AI assistant |
| [Desktop app](docs/desktop.md) | Building, installer, updates, logs |
| [Development](docs/development.md) | Running locally, tests |

## Repository layout

```
cmd/vaultdock        server entry point (serve, healthcheck, backup, reset-password)
internal/            server: API, storage, database, auth
pkg/automation       automation schema, validator and engine (shared with the desktop app)
pkg/client           Go API client (desktop app and integration tests)
pkg/protocol         device request signing
web/                 React web interface (embedded into the server binary)
desktop/             Wails Windows app: sync engine, UI and NSIS installer
tests/integration    end-to-end tests against a running deployment
install.sh           installer / upgrader / uninstaller
Dockerfile, docker-compose.yml
```

## License

Not chosen yet. Add a LICENSE file before publishing the repository.
