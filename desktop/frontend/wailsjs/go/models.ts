export namespace config {
	
	export class Settings {
	    server_url: string;
	    pinned_cert?: string;
	    device_id?: number;
	    device_name?: string;
	    username?: string;
	    key_fingerprint?: string;
	    auto_start: boolean;
	    start_minimized: boolean;
	    close_to_tray: boolean;
	    concurrency_mode: string;
	    manual_parallel: number;
	    max_parallel: number;
	    bandwidth_kbps: number;
	    notifications: boolean;
	    paused: boolean;
	    auto_update: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.server_url = source["server_url"];
	        this.pinned_cert = source["pinned_cert"];
	        this.device_id = source["device_id"];
	        this.device_name = source["device_name"];
	        this.username = source["username"];
	        this.key_fingerprint = source["key_fingerprint"];
	        this.auto_start = source["auto_start"];
	        this.start_minimized = source["start_minimized"];
	        this.close_to_tray = source["close_to_tray"];
	        this.concurrency_mode = source["concurrency_mode"];
	        this.manual_parallel = source["manual_parallel"];
	        this.max_parallel = source["max_parallel"];
	        this.bandwidth_kbps = source["bandwidth_kbps"];
	        this.notifications = source["notifications"];
	        this.paused = source["paused"];
	        this.auto_update = source["auto_update"];
	    }
	}
	export class SyncConfig {
	    id: string;
	    name: string;
	    enabled: boolean;
	    kind: string;
	    local_path: string;
	    files?: string[];
	    destination: string;
	    recursive: boolean;
	    include_subfolders?: string[];
	    exclude_subfolders?: string[];
	    include_extensions?: string[];
	    exclude_extensions?: string[];
	    min_size?: number;
	    max_size?: number;
	    include_patterns?: string[];
	    exclude_patterns?: string[];
	    modified_after?: string;
	    skip_hidden: boolean;
	    mode: string;
	    scan_interval_minutes: number;
	    stable_seconds: number;
	    automation_mode: string;
	    automations?: number[];
	    on_conflict: string;
	    created_at: number;
	    updated_at: number;
	
	    static createFrom(source: any = {}) {
	        return new SyncConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	        this.kind = source["kind"];
	        this.local_path = source["local_path"];
	        this.files = source["files"];
	        this.destination = source["destination"];
	        this.recursive = source["recursive"];
	        this.include_subfolders = source["include_subfolders"];
	        this.exclude_subfolders = source["exclude_subfolders"];
	        this.include_extensions = source["include_extensions"];
	        this.exclude_extensions = source["exclude_extensions"];
	        this.min_size = source["min_size"];
	        this.max_size = source["max_size"];
	        this.include_patterns = source["include_patterns"];
	        this.exclude_patterns = source["exclude_patterns"];
	        this.modified_after = source["modified_after"];
	        this.skip_hidden = source["skip_hidden"];
	        this.mode = source["mode"];
	        this.scan_interval_minutes = source["scan_interval_minutes"];
	        this.stable_seconds = source["stable_seconds"];
	        this.automation_mode = source["automation_mode"];
	        this.automations = source["automations"];
	        this.on_conflict = source["on_conflict"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}

}

export namespace engine {
	
	export class ActiveView {
	    id: number;
	    config: string;
	    path: string;
	    remote: string;
	    size: number;
	    sent: number;
	    speed: number;
	    phase: string;
	    started: number;
	    attempts: number;
	
	    static createFrom(source: any = {}) {
	        return new ActiveView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.config = source["config"];
	        this.path = source["path"];
	        this.remote = source["remote"];
	        this.size = source["size"];
	        this.sent = source["sent"];
	        this.speed = source["speed"];
	        this.phase = source["phase"];
	        this.started = source["started"];
	        this.attempts = source["attempts"];
	    }
	}
	export class AutomationView {
	    id: number;
	    name: string;
	    priority: number;
	    triggers: string[];
	    actions: string[];
	
	    static createFrom(source: any = {}) {
	        return new AutomationView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.priority = source["priority"];
	        this.triggers = source["triggers"];
	        this.actions = source["actions"];
	    }
	}
	export class ConfigView {
	    id: string;
	    name: string;
	    enabled: boolean;
	    kind: string;
	    local_path: string;
	    files?: string[];
	    destination: string;
	    recursive: boolean;
	    include_subfolders?: string[];
	    exclude_subfolders?: string[];
	    include_extensions?: string[];
	    exclude_extensions?: string[];
	    min_size?: number;
	    max_size?: number;
	    include_patterns?: string[];
	    exclude_patterns?: string[];
	    modified_after?: string;
	    skip_hidden: boolean;
	    mode: string;
	    scan_interval_minutes: number;
	    stable_seconds: number;
	    automation_mode: string;
	    automations?: number[];
	    on_conflict: string;
	    created_at: number;
	    updated_at: number;
	    files_synced: number;
	    files_pending: number;
	    files_failed: number;
	    last_scan_at: number;
	    scanning: boolean;
	    last_error: string;
	    watching: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConfigView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	        this.kind = source["kind"];
	        this.local_path = source["local_path"];
	        this.files = source["files"];
	        this.destination = source["destination"];
	        this.recursive = source["recursive"];
	        this.include_subfolders = source["include_subfolders"];
	        this.exclude_subfolders = source["exclude_subfolders"];
	        this.include_extensions = source["include_extensions"];
	        this.exclude_extensions = source["exclude_extensions"];
	        this.min_size = source["min_size"];
	        this.max_size = source["max_size"];
	        this.include_patterns = source["include_patterns"];
	        this.exclude_patterns = source["exclude_patterns"];
	        this.modified_after = source["modified_after"];
	        this.skip_hidden = source["skip_hidden"];
	        this.mode = source["mode"];
	        this.scan_interval_minutes = source["scan_interval_minutes"];
	        this.stable_seconds = source["stable_seconds"];
	        this.automation_mode = source["automation_mode"];
	        this.automations = source["automations"];
	        this.on_conflict = source["on_conflict"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.files_synced = source["files_synced"];
	        this.files_pending = source["files_pending"];
	        this.files_failed = source["files_failed"];
	        this.last_scan_at = source["last_scan_at"];
	        this.scanning = source["scanning"];
	        this.last_error = source["last_error"];
	        this.watching = source["watching"];
	    }
	}
	export class PreviewEntry {
	    rel_path: string;
	    size: number;
	    modified: number;
	    decision: string;
	    reason?: string;
	    remote?: string;
	    tags?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PreviewEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rel_path = source["rel_path"];
	        this.size = source["size"];
	        this.modified = source["modified"];
	        this.decision = source["decision"];
	        this.reason = source["reason"];
	        this.remote = source["remote"];
	        this.tags = source["tags"];
	    }
	}
	export class Stats {
	    active: number;
	    queued: number;
	    failed: number;
	    pending_bytes: number;
	    speed_bps: number;
	    concurrency: number;
	    concurrency_limit: number;
	    eta_seconds: number;
	    session_completed: number;
	    session_bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.queued = source["queued"];
	        this.failed = source["failed"];
	        this.pending_bytes = source["pending_bytes"];
	        this.speed_bps = source["speed_bps"];
	        this.concurrency = source["concurrency"];
	        this.concurrency_limit = source["concurrency_limit"];
	        this.eta_seconds = source["eta_seconds"];
	        this.session_completed = source["session_completed"];
	        this.session_bytes = source["session_bytes"];
	    }
	}
	export class Snapshot {
	    status: string;
	    message: string;
	    paused: boolean;
	    connected: boolean;
	    stats: Stats;
	    active: ActiveView[];
	    automations: number;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.paused = source["paused"];
	        this.connected = source["connected"];
	        this.stats = this.convertValues(source["stats"], Stats);
	        this.active = this.convertValues(source["active"], ActiveView);
	        this.automations = source["automations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class EnrollView {
	    status: string;
	    user_code: string;
	    expires_at: number;
	    key_fingerprint: string;
	    device_name: string;
	    username: string;
	    server_url: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new EnrollView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.user_code = source["user_code"];
	        this.expires_at = source["expires_at"];
	        this.key_fingerprint = source["key_fingerprint"];
	        this.device_name = source["device_name"];
	        this.username = source["username"];
	        this.server_url = source["server_url"];
	        this.error = source["error"];
	    }
	}
	export class Bootstrap {
	    version: string;
	    connected: boolean;
	    configured: boolean;
	    revoked: boolean;
	    enrollment?: EnrollView;
	    settings: config.Settings;
	    device_name: string;
	    os: string;
	    user: string;
	    server_info: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Bootstrap(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.connected = source["connected"];
	        this.configured = source["configured"];
	        this.revoked = source["revoked"];
	        this.enrollment = this.convertValues(source["enrollment"], EnrollView);
	        this.settings = this.convertValues(source["settings"], config.Settings);
	        this.device_name = source["device_name"];
	        this.os = source["os"];
	        this.user = source["user"];
	        this.server_info = source["server_info"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PreviewResult {
	    entries: engine.PreviewEntry[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new PreviewResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], engine.PreviewEntry);
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProbeResult {
	    ok: boolean;
	    info?: Record<string, any>;
	    untrusted: boolean;
	    fingerprint?: string;
	    subject?: string;
	    reason?: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new ProbeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.info = source["info"];
	        this.untrusted = source["untrusted"];
	        this.fingerprint = source["fingerprint"];
	        this.subject = source["subject"];
	        this.reason = source["reason"];
	        this.url = source["url"];
	    }
	}

}

export namespace state {
	
	export class HistoryEntry {
	    id: number;
	    config_id: string;
	    rel_path: string;
	    remote_path: string;
	    size: number;
	    status: string;
	    result: string;
	    error: string;
	    duration_ms: number;
	    finished_at: number;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.config_id = source["config_id"];
	        this.rel_path = source["rel_path"];
	        this.remote_path = source["remote_path"];
	        this.size = source["size"];
	        this.status = source["status"];
	        this.result = source["result"];
	        this.error = source["error"];
	        this.duration_ms = source["duration_ms"];
	        this.finished_at = source["finished_at"];
	    }
	}
	export class Item {
	    id: number;
	    config_id: string;
	    rel_path: string;
	    event: string;
	    size: number;
	    mtime: number;
	    remote_dir: string;
	    remote_name: string;
	    tags: string[];
	    attempts: number;
	    next_at: number;
	    status: string;
	    error: string;
	    manual: boolean;
	    created_at: number;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.config_id = source["config_id"];
	        this.rel_path = source["rel_path"];
	        this.event = source["event"];
	        this.size = source["size"];
	        this.mtime = source["mtime"];
	        this.remote_dir = source["remote_dir"];
	        this.remote_name = source["remote_name"];
	        this.tags = source["tags"];
	        this.attempts = source["attempts"];
	        this.next_at = source["next_at"];
	        this.status = source["status"];
	        this.error = source["error"];
	        this.manual = source["manual"];
	        this.created_at = source["created_at"];
	    }
	}

}

export namespace updater {
	
	export class Status {
	    state: string;
	    current: string;
	    latest?: string;
	    url?: string;
	    notes?: string;
	    progress: number;
	    error?: string;
	    checked_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.url = source["url"];
	        this.notes = source["notes"];
	        this.progress = source["progress"];
	        this.error = source["error"];
	        this.checked_at = source["checked_at"];
	    }
	}

}

