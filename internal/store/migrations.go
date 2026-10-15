package store

// migrations are applied in order inside a transaction each. Never edit a
// released migration; append a new one instead.
var migrations = []string{
	// 1: initial schema
	`
CREATE TABLE settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE storage_locations (
	id            INTEGER PRIMARY KEY,
	name          TEXT NOT NULL UNIQUE,
	path          TEXT NOT NULL UNIQUE,
	reserve_bytes INTEGER NOT NULL DEFAULT 0,
	enabled       INTEGER NOT NULL DEFAULT 1,
	is_default    INTEGER NOT NULL DEFAULT 0,
	created_at    INTEGER NOT NULL
);

CREATE TABLE users (
	id            INTEGER PRIMARY KEY,
	username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
	email         TEXT UNIQUE COLLATE NOCASE,
	display_name  TEXT NOT NULL DEFAULT '',
	password_hash TEXT NOT NULL,
	role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
	disabled      INTEGER NOT NULL DEFAULT 0,
	quota_bytes   INTEGER NOT NULL DEFAULT 0,
	used_bytes    INTEGER NOT NULL DEFAULT 0,
	location_id   INTEGER REFERENCES storage_locations(id),
	root_id       INTEGER,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL,
	last_login_at INTEGER
);

CREATE TABLE sessions (
	id           TEXT PRIMARY KEY,
	user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	csrf         TEXT NOT NULL,
	ip           TEXT NOT NULL DEFAULT '',
	user_agent   TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE nodes (
	id                 INTEGER PRIMARY KEY,
	user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	parent_id          INTEGER REFERENCES nodes(id),
	name               TEXT NOT NULL,
	is_dir             INTEGER NOT NULL,
	size               INTEGER NOT NULL DEFAULT 0,
	sha256             TEXT,
	mime               TEXT NOT NULL DEFAULT '',
	created_at         INTEGER NOT NULL,
	modified_at        INTEGER NOT NULL,
	updated_at         INTEGER NOT NULL,
	deleted_at         INTEGER,
	trash_root         INTEGER NOT NULL DEFAULT 0,
	original_parent_id INTEGER,
	origin_device_id   INTEGER
);
CREATE UNIQUE INDEX nodes_unique_name ON nodes(user_id, parent_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX nodes_parent ON nodes(parent_id);
CREATE INDEX nodes_user_sha ON nodes(user_id, sha256);
CREATE INDEX nodes_trash ON nodes(user_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX nodes_user_name ON nodes(user_id, name COLLATE NOCASE);

CREATE TABLE node_tags (
	node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
	tag     TEXT NOT NULL COLLATE NOCASE,
	PRIMARY KEY (node_id, tag)
);
CREATE INDEX node_tags_tag ON node_tags(tag);

CREATE TABLE blobs (
	user_id     INTEGER NOT NULL,
	sha256      TEXT NOT NULL,
	size        INTEGER NOT NULL,
	location_id INTEGER NOT NULL REFERENCES storage_locations(id),
	refcount    INTEGER NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (user_id, sha256)
);

CREATE TABLE devices (
	id               INTEGER PRIMARY KEY,
	user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name             TEXT NOT NULL,
	os               TEXT NOT NULL DEFAULT '',
	client_version   TEXT NOT NULL DEFAULT '',
	identifier       TEXT NOT NULL,
	public_key       TEXT NOT NULL,
	key_fingerprint  TEXT NOT NULL,
	status           TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked','expired')),
	user_code        TEXT NOT NULL,
	poll_token_hash  TEXT,
	request_ip       TEXT NOT NULL DEFAULT '',
	request_location TEXT NOT NULL DEFAULT '',
	created_at       INTEGER NOT NULL,
	expires_at       INTEGER NOT NULL,
	decided_at       INTEGER,
	decided_by       INTEGER,
	last_seen_at     INTEGER,
	last_ip          TEXT NOT NULL DEFAULT '',
	sync_state       TEXT NOT NULL DEFAULT '{}',
	sync_state_at    INTEGER
);
CREATE INDEX devices_user ON devices(user_id, status);

CREATE TABLE uploads (
	id             TEXT PRIMARY KEY,
	user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device_id      INTEGER,
	transfer_id    INTEGER,
	path           TEXT NOT NULL,
	size           INTEGER NOT NULL,
	sha256         TEXT NOT NULL DEFAULT '',
	chunk_size     INTEGER NOT NULL,
	chunks_total   INTEGER NOT NULL,
	received       BLOB NOT NULL,
	bytes_received INTEGER NOT NULL DEFAULT 0,
	location_id    INTEGER NOT NULL,
	modified_at    INTEGER NOT NULL,
	tags           TEXT NOT NULL DEFAULT '[]',
	on_conflict    TEXT NOT NULL DEFAULT 'replace',
	status         TEXT NOT NULL DEFAULT 'open',
	created_at     INTEGER NOT NULL,
	updated_at     INTEGER NOT NULL,
	expires_at     INTEGER NOT NULL
);
CREATE INDEX uploads_user ON uploads(user_id, status);

CREATE TABLE transfers (
	id          INTEGER PRIMARY KEY,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device_id   INTEGER,
	upload_id   TEXT,
	path        TEXT NOT NULL,
	size        INTEGER NOT NULL DEFAULT 0,
	bytes_done  INTEGER NOT NULL DEFAULT 0,
	status      TEXT NOT NULL,
	error       TEXT NOT NULL DEFAULT '',
	source      TEXT NOT NULL DEFAULT 'web',
	started_at  INTEGER NOT NULL,
	finished_at INTEGER
);
CREATE INDEX transfers_user ON transfers(user_id, started_at);
CREATE INDEX transfers_status ON transfers(status);

CREATE TABLE automations (
	id          INTEGER PRIMARY KEY,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name        TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	enabled     INTEGER NOT NULL DEFAULT 0,
	priority    INTEGER NOT NULL DEFAULT 0,
	is_template INTEGER NOT NULL DEFAULT 0,
	valid       INTEGER NOT NULL DEFAULT 0,
	definition  TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX automations_user ON automations(user_id);

CREATE TABLE activity (
	id         INTEGER PRIMARY KEY,
	user_id    INTEGER,
	actor_id   INTEGER,
	device_id  INTEGER,
	action     TEXT NOT NULL,
	target     TEXT NOT NULL DEFAULT '',
	details    TEXT NOT NULL DEFAULT '',
	ip         TEXT NOT NULL DEFAULT '',
	audit      INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE INDEX activity_user ON activity(user_id, id);
CREATE INDEX activity_audit ON activity(audit, id);

CREATE TABLE notifications (
	id         INTEGER PRIMARY KEY,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title      TEXT NOT NULL,
	message    TEXT NOT NULL DEFAULT '',
	level      TEXT NOT NULL DEFAULT 'info',
	source     TEXT NOT NULL DEFAULT '',
	read_at    INTEGER,
	created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, id);
`,
}
