#!/usr/bin/env bash
# VaultDock installer: install / replace, upgrade, uninstall.
#
#   curl -fsSL https://raw.githubusercontent.com/ASPEC-RACING-PTY-LTD/VaultDock/main/install.sh | bash
#   ./install.sh                 # interactive menu
#   ./install.sh install|upgrade|uninstall|status [--yes]
#   ./install.sh upgrade --if-newer   # only upgrade when a newer release exists
#   ./install.sh auto-update on|off|status
#
# Environment overrides:
#   VAULTDOCK_DIR      installation directory (default: $HOME/VaultDock)
#   VAULTDOCK_REPO     GitHub "owner/name" to download from
#   VAULTDOCK_REF      branch or tag to install (default: the latest release,
#                      or main when no release has been published)
#   VAULTDOCK_SOURCE   use this local source directory instead of downloading
#   VAULTDOCK_IMAGE    pull this prebuilt image instead of building locally
#                      (releases use ghcr.io/<repo>:<version> automatically)
#   VAULTDOCK_REBUILD=0  reuse an existing local vaultdock:local image
#   VAULTDOCK_YES=1    accept defaults for every prompt (non-interactive)
#
# The script never deletes user files, databases or configuration without an
# explicit, typed confirmation.
set -Eeuo pipefail
umask 027

REPO="${VAULTDOCK_REPO:-ASPEC-RACING-PTY-LTD/VaultDock}"
REF="${VAULTDOCK_REF:-}"
IF_NEWER=0
RELEASE_VERSION=""
YES="${VAULTDOCK_YES:-0}"
PROJECT="vaultdock"

# --- output helpers ----------------------------------------------------------
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'; else B= G= Y= R= C= N=; fi
info()  { printf '%s\n' "${C}==>${N} $*"; }
ok()    { printf '%s\n' "${G}✔${N} $*"; }
warn()  { printf '%s\n' "${Y}!${N} $*" >&2; }
die()   { printf '%s\n' "${R}✖ $*${N}" >&2; exit 1; }
trap 'die "Unexpected error on line $LINENO. Nothing was deleted; see the messages above."' ERR

# Prompts read from the terminal so `curl ... | bash` still works.
TTY=/dev/tty
have_tty() { [ -r "$TTY" ] && { : <"$TTY"; } 2>/dev/null; }
ask() { # ask VAR "question" "default"
	local __var=$1 q=$2 def=${3-} ans=
	if [ "$YES" = 1 ] || ! have_tty; then printf -v "$__var" '%s' "$def"; return; fi
	read -r -p "$q${def:+ [$def]}: " ans <"$TTY" || true
	printf -v "$__var" '%s' "${ans:-$def}"
}
confirm() { # confirm "question" default(y/n)
	local def=${2:-n} ans
	if [ "$YES" = 1 ]; then [ "$def" = y ]; return; fi
	have_tty || { [ "$def" = y ]; return; }
	read -r -p "$1 [$( [ "$def" = y ] && echo Y/n || echo y/N )]: " ans <"$TTY" || true
	ans=${ans:-$def}
	[[ "$ans" =~ ^[Yy] ]]
}
typed_confirm() { # typed_confirm "phrase" -- always interactive, never auto-accepted
	local ans
	have_tty || die "Destructive actions need an interactive terminal."
	read -r -p "Type '$1' to confirm: " ans <"$TTY" || true
	[ "$ans" = "$1" ]
}

# --- locations -----------------------------------------------------------------
SCRIPT_SRC="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [ -n "$SCRIPT_SRC" ] && [ -f "$SCRIPT_SRC" ]; then
	SCRIPT_DIR=$(cd -- "$(dirname -- "$SCRIPT_SRC")" && pwd -P)
fi

default_dir() {
	# Installs always go to a dedicated directory, never scattered in $HOME.
	# Run from ~ or /root this is ~/VaultDock or /root/VaultDock.
	if [ -n "${VAULTDOCK_DIR:-}" ]; then printf '%s' "$VAULTDOCK_DIR"; return; fi
	local home=${HOME:-}
	[ -n "$home" ] || home=$(getent passwd "$(id -un)" | cut -d: -f6)
	printf '%s/VaultDock' "${home%/}"
}

DIR=$(default_dir)
APP="$DIR/app"
ENV_FILE="$DIR/.env"
BACKUPS="$DIR/backups"

compose() {
	docker compose -p "$PROJECT" -f "$APP/docker-compose.yml" --env-file "$ENV_FILE" "$@"
}

env_get() { # env_get KEY
	[ -f "$ENV_FILE" ] || return 0
	grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true
}

# --- checks --------------------------------------------------------------------
require() {
	command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine (https://docs.docker.com/engine/install/) and run this again."
	docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Is it running, and is your user allowed to use it (sudo or the docker group)?"
	docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is required (docker compose). Install docker-compose-plugin."
	command -v tar >/dev/null 2>&1 || die "tar is required."
	if [ -z "$(local_source)" ]; then
		command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required to download VaultDock."
	fi
}

is_repo() { [ -n "${1:-}" ] && [ -f "$1/Dockerfile" ] && [ -f "$1/docker-compose.yml" ] && [ -f "$1/go.mod" ]; }

# local_source prints the source tree to install from, if any. The installed
# copy in $APP is never used as a source, so running $APP/install.sh upgrade
# downloads the new release instead of reinstalling itself.
local_source() {
	if [ -n "${VAULTDOCK_SOURCE:-}" ]; then printf '%s' "$VAULTDOCK_SOURCE"; return; fi
	is_repo "$SCRIPT_DIR" || return 0
	local app_real; app_real=$(cd -- "$APP" 2>/dev/null && pwd -P || true)
	[ "$SCRIPT_DIR" = "$app_real" ] || [ "$SCRIPT_DIR" = "$(cd -- "$APP.old" 2>/dev/null && pwd -P || true)" ] || printf '%s' "$SCRIPT_DIR"
}

http_get() { # http_get URL -> stdout
	if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$1"
	else wget -qO- --header='Accept: application/vnd.github+json' "$1"; fi
}

# latest_release prints the tag of the latest published release, or nothing.
latest_release() {
	[ -n "$REPO" ] || return 0
	http_get "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
		grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/' || true
}

# resolve_ref picks what to install: VAULTDOCK_REF, else the latest release,
# else main. Release tags (vX.Y.Z) also set RELEASE_VERSION.
resolve_ref() {
	if [ -z "$REF" ]; then
		REF=$(latest_release)
		if [ -z "$REF" ]; then
			REF=main
			[ "$IF_NEWER" = 1 ] || warn "No published release found for $REPO; installing the main branch."
		fi
	fi
	if [[ "$REF" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]]; then RELEASE_VERSION=${REF#v}; else RELEASE_VERSION=""; fi
}

installed() { [ -f "$ENV_FILE" ] && [ -f "$APP/docker-compose.yml" ]; }

random_token() {
	if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
	else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# --- source --------------------------------------------------------------------
fetch_source() { # fetch_source DEST
	local dest=$1 src
	src=$(local_source)
	rm -rf -- "$dest"
	mkdir -p -- "$dest"
	if [ -n "$src" ]; then
		is_repo "$src" || die "$src does not look like a VaultDock source directory."
		info "Using local source: $src"
		(cd -- "$src" && tar --exclude=./.git --exclude=./data --exclude=./.dev-data --exclude='./desktop' --exclude='*/node_modules' --exclude=./backups -cf - .) | (cd -- "$dest" && tar -xf -)
	else
		[ -n "$REPO" ] || die "No repository configured. Set VAULTDOCK_REPO=owner/name or run it from a cloned repository."
		[ -n "$REF" ] || resolve_ref
		local url="https://github.com/$REPO/archive/$REF.tar.gz" tmp
		tmp=$(mktemp)
		info "Downloading $url"
		if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$tmp" "$url"; else wget -qO "$tmp" "$url"; fi
		tar -xzf "$tmp" -C "$dest" --strip-components=1
		rm -f -- "$tmp"
	fi
	is_repo "$dest" || die "Downloaded source is incomplete."
}

# build_image: a registry image (VAULTDOCK_IMAGE) is reused or pulled, falling
# back to a source build if it cannot be pulled. Otherwise the image is built
# from source; VAULTDOCK_REBUILD=0 reuses an existing local build.
release_image() { # the prebuilt image published for RELEASE_VERSION, if any
	if [ -n "$RELEASE_VERSION" ] && [ -z "$(local_source)" ]; then
		printf 'ghcr.io/%s:%s' "$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')" "$RELEASE_VERSION"
	else
		printf 'vaultdock:local'
	fi
}

build_image() {
	local img=${VAULTDOCK_IMAGE:-$(release_image)}
	[ -z "$RELEASE_VERSION" ] || set_env VAULTDOCK_VERSION "$RELEASE_VERSION"
	if [ "$img" != "vaultdock:local" ]; then
		if docker image inspect "$img" >/dev/null 2>&1 && [ "${VAULTDOCK_PULL:-0}" != 1 ]; then
			info "Using existing image $img"
			set_env VAULTDOCK_IMAGE "$img"
			return
		fi
		info "Pulling $img"
		if docker pull "$img"; then
			set_env VAULTDOCK_IMAGE "$img"
			return
		fi
		warn "Could not pull $img; building from source instead."
	elif [ "${VAULTDOCK_REBUILD:-1}" = 0 ] && docker image inspect "$img" >/dev/null 2>&1; then
		info "Reusing the existing local image"
		set_env VAULTDOCK_IMAGE "$img"
		return
	fi
	info "Building the VaultDock image (first build downloads base images and can take a few minutes)"
	local ver=$RELEASE_VERSION
	[ -n "$ver" ] || ver=$(git -C "$(local_source)" describe --tags --always 2>/dev/null || true)
	[ -n "$ver" ] || ver="$REF-$(date +%Y%m%d%H%M)"
	set_env VAULTDOCK_VERSION "${ver#v}"
	set_env VAULTDOCK_IMAGE "vaultdock:local"
	compose build vaultdock
}

set_env() { # set_env KEY VALUE  (update or append in .env)
	local key=$1 val=$2 tmp
	tmp=$(mktemp)
	if [ -f "$ENV_FILE" ] && grep -qE "^$key=" "$ENV_FILE"; then
		awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "$ENV_FILE" >"$tmp"
	else
		{ [ -f "$ENV_FILE" ] && cat "$ENV_FILE"; printf '%s=%s\n' "$key" "$val"; } >"$tmp"
	fi
	cat "$tmp" >"$ENV_FILE"
	rm -f -- "$tmp"
	chmod 600 "$ENV_FILE"
}

prepare_dirs() {
	local state storage uid gid
	state=$(env_get VAULTDOCK_STATE_PATH); storage=$(env_get VAULTDOCK_STORAGE_PATH)
	uid=$(env_get VAULTDOCK_UID); gid=$(env_get VAULTDOCK_GID)
	mkdir -p -- "$state" "$storage" "$BACKUPS"
	if [ "$(id -u)" = 0 ]; then
		chown "$uid:$gid" -- "$state" "$storage"
	fi
	chmod 750 -- "$state" "$storage"
}

wait_healthy() {
	local port bind url i
	port=$(env_get VAULTDOCK_PORT); port=${port:-8080}
	url="http://127.0.0.1:$port/readyz"
	if [ "$(env_get VAULTDOCK_TLS_SELF_SIGNED)" = true ]; then url="https://127.0.0.1:$port/readyz"; fi
	info "Waiting for VaultDock to become ready"
	for i in $(seq 1 60); do
		if [ "$(docker inspect -f '{{.State.Health.Status}}' vaultdock 2>/dev/null || true)" = healthy ]; then ok "VaultDock is running"; return 0; fi
		if [ "$(docker inspect -f '{{.State.Running}}' vaultdock 2>/dev/null || true)" != true ] && [ "$i" -gt 5 ]; then break; fi
		sleep 2
	done
	warn "VaultDock did not become healthy. Recent logs:"
	compose logs --tail 40 vaultdock >&2 || true
	return 1
}

# --- install -------------------------------------------------------------------
write_env() {
	local storage port url mode domain token uid gid
	info "Configuration"
	printf '  Installation directory: %s\n' "$DIR"
	ask storage "Where should VaultDock store files? (use a path on your HDD or mounted volume)" "$DIR/data/storage"
	case "$storage" in /*) ;; *) die "Use an absolute path for storage." ;; esac
	ask port "Port to publish VaultDock on" "8080"
	[[ "$port" =~ ^[0-9]+$ ]] || die "Port must be a number."
	ask url "Public URL users will open (used in messages)" "http://$(hostname -f 2>/dev/null || hostname):$port"
	printf '  HTTPS options:\n    1) none - I use my own HTTPS reverse proxy or only test on this machine\n    2) built-in Caddy with a Let'"'"'s Encrypt certificate (needs a domain and ports 80/443)\n    3) self-signed certificate (LAN; the desktop app asks you to verify its fingerprint)\n'
	ask mode "Choose 1, 2 or 3" "1"
	if [ "$(id -u)" = 0 ]; then uid=65532; gid=65532; else uid=$(id -u); gid=$(id -g); fi
	token=$(random_token)
	{
		echo "# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep this file private."
		echo "VAULTDOCK_ENV_FILE=$ENV_FILE"
		echo "VAULTDOCK_STATE_PATH=$DIR/data/state"
		echo "VAULTDOCK_STORAGE_PATH=$storage"
		echo "VAULTDOCK_UID=$uid"
		echo "VAULTDOCK_GID=$gid"
		echo "VAULTDOCK_PORT=$port"
		echo "VAULTDOCK_BIND=0.0.0.0"
		echo "VAULTDOCK_PUBLIC_URL=$url"
		echo "VAULTDOCK_SETUP_TOKEN=$token"
		echo "VAULTDOCK_COOKIE_SECURE=auto"
		echo "VAULTDOCK_LOG_FORMAT=json"
		echo "VAULTDOCK_UPDATE_REPO=$REPO"
		echo "VAULTDOCK_AUTO_UPDATE=off"
	} >"$ENV_FILE"
	chmod 600 "$ENV_FILE"
	case "$mode" in
	2)
		ask domain "Domain name pointing at this server" ""
		[ -n "$domain" ] || die "A domain is required for Let's Encrypt."
		set_env COMPOSE_PROFILES caddy
		set_env VAULTDOCK_DOMAIN "$domain"
		set_env VAULTDOCK_PUBLIC_URL "https://$domain"
		set_env VAULTDOCK_TRUSTED_PROXIES "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"
		set_env VAULTDOCK_BIND 127.0.0.1
		;;
	3)
		set_env VAULTDOCK_TLS_SELF_SIGNED true
		set_env VAULTDOCK_TLS_HOSTS "$(hostname -I 2>/dev/null | tr ' ' ',' | sed 's/,$//')"
		set_env VAULTDOCK_PUBLIC_URL "https://$(hostname -I 2>/dev/null | awk '{print $1}'):$port"
		;;
	esac
}

do_install() {
	require
	mkdir -p -- "$DIR"
	if installed; then
		warn "VaultDock is already installed in $DIR."
		printf '  1) Reinstall the application and keep all data and settings (same as upgrade)\n  2) Fresh install: move the existing data and settings aside to %s (nothing is deleted)\n  3) Cancel\n' "$BACKUPS"
		local choice; ask choice "Choose" "3"
		case "$choice" in
		1) do_upgrade; return ;;
		2)
			local ts dest; ts=$(date +%Y%m%d-%H%M%S); dest="$BACKUPS/replaced-$ts"
			confirm "Stop VaultDock and move $DIR/data and .env to $dest?" n || die "Cancelled."
			compose down || true
			mkdir -p -- "$dest"
			[ -d "$DIR/data" ] && mv -- "$DIR/data" "$dest/"
			mv -- "$ENV_FILE" "$dest/.env"
			local old_storage; old_storage=$(grep -E '^VAULTDOCK_STORAGE_PATH=' "$dest/.env" | cut -d= -f2- || true)
			if [ -n "$old_storage" ] && [ -d "$old_storage" ] && [[ "$old_storage" != "$DIR/data/"* ]]; then
				warn "Stored files at $old_storage are outside the install directory and were left untouched. Choose a different storage path or move them yourself."
			fi
			ok "Previous installation preserved in $dest"
			;;
		*) die "Cancelled. Nothing was changed." ;;
		esac
	fi
	fetch_source "$APP"
	write_env
	prepare_dirs
	build_image
	info "Starting VaultDock"
	compose up -d
	wait_healthy || die "Installation finished but VaultDock is not healthy. Fix the problem above, then run: $0 upgrade"
	print_summary
}

print_summary() {
	cat <<EOF

${B}VaultDock is installed.${N}
  Open:            $(env_get VAULTDOCK_PUBLIC_URL)
  Setup token:     $(env_get VAULTDOCK_SETUP_TOKEN)   (needed once to create the administrator)
  Install dir:     $DIR
  Files stored in: $(env_get VAULTDOCK_STORAGE_PATH)
  Database/state:  $(env_get VAULTDOCK_STATE_PATH)
  Manage:          $DIR/app/install.sh   (install / upgrade / uninstall)
  Logs:            docker logs -f vaultdock

Next: open the URL, create the administrator with the setup token, then
install the VaultDock desktop app on Windows and connect it to this server.
For remote access put VaultDock behind HTTPS (see docs/deployment.md).
EOF
}

# --- upgrade -------------------------------------------------------------------
# version_newer A B: true when release A is newer than B. A non-version B
# (for example a build of the main branch) is always considered older.
version_newer() {
	local a=${1%%[-+]*} b=${2%%[-+]*} i x y
	local -a A B
	[[ "$b" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || return 0
	IFS=. read -r -a A <<<"$a"; IFS=. read -r -a B <<<"$b"
	for i in 0 1 2; do
		x=${A[$i]:-0}; y=${B[$i]:-0}
		((10#$x > 10#$y)) && return 0
		((10#$x < 10#$y)) && return 1
	done
	# Same core version: a final release is newer than a pre-release of it.
	[ "$1" = "$a" ] && [ "$2" != "$b" ]
}

backup_now() { # backup_now -> prints backup dir
	local ts dest; ts=$(date +%Y%m%d-%H%M%S); dest="$BACKUPS/upgrade-$ts"
	mkdir -p -- "$dest"
	cp -p -- "$ENV_FILE" "$dest/.env"
	if [ "$(docker inspect -f '{{.State.Running}}' vaultdock 2>/dev/null || true)" = true ]; then
		docker exec vaultdock vaultdock backup "/state/vaultdock-backup-$ts.db" >/dev/null
		mv -- "$(env_get VAULTDOCK_STATE_PATH)/vaultdock-backup-$ts.db" "$dest/vaultdock.db"
	else
		cp -p -- "$(env_get VAULTDOCK_STATE_PATH)/vaultdock.db" "$dest/vaultdock.db" 2>/dev/null || warn "No database found to back up."
	fi
	(cd -- "$DIR" && tar -cf "$dest/app.tar" app)
	printf '%s' "$dest"
}

# upgrade_lock makes sure only one upgrade (manual or scheduled) runs at a time.
upgrade_lock() {
	command -v flock >/dev/null 2>&1 || return 0
	exec 9>"$DIR/.upgrade.lock"
	flock -n 9 || die "Another upgrade is already running."
}

do_upgrade() {
	require
	installed || die "No VaultDock installation found in $DIR. Choose Install first."
	upgrade_lock
	if [ -z "$(local_source)" ]; then
		resolve_ref
		local current; current=$(env_get VAULTDOCK_VERSION)
		if [ "$IF_NEWER" = 1 ]; then
			if [ -z "$RELEASE_VERSION" ]; then
				info "No published release to upgrade to. Nothing to do."
				return 0
			fi
			if [ "${current#v}" = "$RELEASE_VERSION" ] || ! version_newer "$RELEASE_VERSION" "${current#v}"; then
				info "VaultDock ${current:-?} is up to date (latest release: $RELEASE_VERSION)."
				return 0
			fi
		fi
		info "Upgrading VaultDock ${current:-?} to ${RELEASE_VERSION:-$REF}"
	fi
	[ -n "$(env_get VAULTDOCK_UPDATE_REPO)" ] || set_env VAULTDOCK_UPDATE_REPO "$REPO"
	info "Backing up the database, configuration and application files"
	local bk; bk=$(backup_now)
	ok "Backup written to $bk"
	local prev_image; prev_image=$(env_get VAULTDOCK_IMAGE); prev_image=${prev_image:-vaultdock:local}
	local prev_version; prev_version=$(env_get VAULTDOCK_VERSION)
	docker image inspect "$prev_image" >/dev/null 2>&1 && docker tag "$prev_image" vaultdock:rollback
	fetch_source "$APP.new"
	[ -n "$(env_get VAULTDOCK_ENV_FILE)" ] || set_env VAULTDOCK_ENV_FILE "$ENV_FILE"
	rm -rf -- "$APP.old"; mv -- "$APP" "$APP.old"; mv -- "$APP.new" "$APP"
	if ! build_image; then
		warn "Build failed; restoring the previous version."
		rm -rf -- "$APP"; mv -- "$APP.old" "$APP"
		set_env VAULTDOCK_IMAGE "$prev_image"; set_env VAULTDOCK_VERSION "$prev_version"
		die "Upgrade aborted. The previous version is still running."
	fi
	info "Restarting with the new version (database migrations run automatically)"
	compose up -d --remove-orphans
	if wait_healthy; then
		rm -rf -- "$APP.old"
		ok "Upgrade complete. Backup kept at $bk"
		return
	fi
	warn "The new version is not healthy. Rolling back to the previous version and database backup."
	compose down || true
	rm -rf -- "$APP"; mv -- "$APP.old" "$APP"
	cp -p -- "$bk/vaultdock.db" "$(env_get VAULTDOCK_STATE_PATH)/vaultdock.db"
	rm -f -- "$(env_get VAULTDOCK_STATE_PATH)/vaultdock.db-wal" "$(env_get VAULTDOCK_STATE_PATH)/vaultdock.db-shm"
	docker image inspect vaultdock:rollback >/dev/null 2>&1 && docker tag vaultdock:rollback "$prev_image"
	set_env VAULTDOCK_IMAGE "$prev_image"; set_env VAULTDOCK_VERSION "$prev_version"
	compose up -d
	wait_healthy || true
	die "Upgrade failed and was rolled back. Backup: $bk"
}

# --- scheduled updates ---------------------------------------------------------
CRON_TAG="# vaultdock-auto-update $DIR"

cron_line() {
	printf '0 4 * * * PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin VAULTDOCK_DIR=%q VAULTDOCK_YES=1 %q upgrade --if-newer >>%q 2>&1 %s\n' \
		"$DIR" "$APP/install.sh" "$DIR/logs/auto-update.log" "$CRON_TAG"
}

current_crontab() { crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true; }

apply_auto_update_env() { # apply_auto_update_env on|off
	set_env VAULTDOCK_AUTO_UPDATE "$1"
	# Recreate the container so the admin console shows the new setting.
	if [ "$(docker inspect -f '{{.State.Running}}' vaultdock 2>/dev/null || true)" = true ]; then
		if compose up -d >/dev/null 2>&1; then
			wait_healthy >/dev/null 2>&1 || warn "VaultDock is restarting slowly; check: docker logs vaultdock"
		else
			warn "Could not restart VaultDock; the admin console shows the change after the next restart."
		fi
	fi
}

do_auto_update() {
	installed || die "No VaultDock installation found in $DIR."
	local action=${1:-status}
	case "$action" in
	on)
		command -v crontab >/dev/null 2>&1 || die "Scheduled updates need cron (the crontab command). Install cron, or run '$APP/install.sh upgrade' yourself."
		mkdir -p -- "$DIR/logs"
		{ current_crontab; cron_line; } | crontab -
		apply_auto_update_env on
		ok "Automatic updates are on. VaultDock checks every day at 04:00 and installs new releases."
		printf '  Log: %s\n' "$DIR/logs/auto-update.log"
		;;
	off)
		if command -v crontab >/dev/null 2>&1; then current_crontab | crontab -; fi
		apply_auto_update_env off
		ok "Automatic updates are off."
		;;
	status)
		if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF "$CRON_TAG"; then
			ok "Automatic updates are on (daily at 04:00)."
		else
			info "Automatic updates are off. Turn them on with: $APP/install.sh auto-update on"
		fi
		printf '  Installed version: %s\n' "$(env_get VAULTDOCK_VERSION)"
		if [ -f "$DIR/logs/auto-update.log" ]; then
			printf '  Last log lines (%s):\n' "$DIR/logs/auto-update.log"
			tail -n 5 "$DIR/logs/auto-update.log" | sed 's/^/    /'
		fi
		;;
	*) die "Use: auto-update on|off|status" ;;
	esac
}

# --- uninstall -----------------------------------------------------------------
do_uninstall() {
	installed || die "No VaultDock installation found in $DIR."
	command -v docker >/dev/null 2>&1 || die "Docker is required to remove the containers."
	local storage state; storage=$(env_get VAULTDOCK_STORAGE_PATH); state=$(env_get VAULTDOCK_STATE_PATH)
	cat <<EOF
${B}Uninstall VaultDock${N}
  1) Remove the VaultDock services only. Keeps every stored file, the database,
     settings and backups in $DIR so you can reinstall later.
  2) Remove the services AND permanently delete all VaultDock data:
       stored files: $storage
       database:     $state
       settings, backups and application files in $DIR
  3) Cancel
EOF
	local choice; ask choice "Choose" "3"
	case "$choice" in
	1)
		confirm "Stop and remove the VaultDock containers?" n || die "Cancelled."
		if command -v crontab >/dev/null 2>&1; then current_crontab | crontab - || true; fi
		compose down --remove-orphans
		docker image rm vaultdock:local vaultdock:rollback >/dev/null 2>&1 || true
		ok "Services removed. Your data is still in $DIR (storage: $storage)."
		;;
	2)
		warn "This permanently deletes every file stored in VaultDock. It cannot be undone."
		typed_confirm "DELETE ALL DATA" || die "Cancelled. Nothing was deleted."
		if command -v crontab >/dev/null 2>&1; then current_crontab | crontab - || true; fi
		compose down --remove-orphans --volumes
		docker image rm vaultdock:local vaultdock:rollback >/dev/null 2>&1 || true
		if [ -n "$storage" ] && [ "$storage" != "/" ] && [ -d "$storage" ]; then
			rm -rf -- "$storage"
		fi
		rm -rf -- "$DIR"
		ok "VaultDock and all its data were removed."
		;;
	*) die "Cancelled. Nothing was changed." ;;
	esac
}

do_status() {
	if installed; then
		info "Installed in $DIR"
		compose ps || true
	else
		info "Not installed in $DIR"
	fi
}

menu() {
	printf '\n%sVaultDock installer%s  (install directory: %s)\n' "$B" "$N" "$DIR"
	if installed; then printf '  Existing installation detected.\n'; fi
	printf '  1) Install / Replace\n  2) Upgrade\n  3) Uninstall\n  4) Automatic updates\n  q) Quit\n'
	local choice; ask choice "Choose an option" "q"
	case "$choice" in
	1) do_install ;;
	2) do_upgrade ;;
	3) do_uninstall ;;
	4)
		do_auto_update status
		local a; ask a "Turn automatic updates on or off? (on/off, empty to keep)" ""
		case "$a" in on|off) do_auto_update "$a" ;; esac
		;;
	*) echo "Bye." ;;
	esac
}

main() {
	local cmd=${1:-}
	for a in "$@"; do
		case "$a" in
		--yes) YES=1 ;;
		--if-newer) IF_NEWER=1 ;;
		esac
	done
	case "$cmd" in
	install) do_install ;;
	upgrade) do_upgrade ;;
	uninstall) do_uninstall ;;
	status) do_status ;;
	auto-update) do_auto_update "${2:-status}" ;;
	""|--yes) menu ;;
	-h|--help) sed -n '2,24p' "$0" ;;
	*) die "Unknown command: $cmd (use install, upgrade, uninstall, status or auto-update)" ;;
	esac
}

main "$@"
