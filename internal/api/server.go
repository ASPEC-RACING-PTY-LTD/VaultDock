// Package api implements the VaultDock HTTP API and serves the web UI.
package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vaultdock/vaultdock/internal/auth"
	"github.com/vaultdock/vaultdock/internal/config"
	"github.com/vaultdock/vaultdock/internal/storage"
	"github.com/vaultdock/vaultdock/internal/store"
	"github.com/vaultdock/vaultdock/pkg/protocol"
)

// Version is set at build time.
var Version = "dev"

type Server struct {
	cfg      *config.Config
	st       *store.Store
	blobs    *storage.Manager
	settings *SettingsCache
	geo      *Geo
	started  time.Time

	loginLimiter  *auth.Limiter
	enrollLimiter *auth.Limiter
	apiLimiter    *auth.Limiter
	pollLimiter   *auth.Limiter
	loginFails    *auth.FailureTracker
	nonces        *auth.NonceCache
	chunkSem      chan struct{}

	touchMu   sync.Mutex
	lastTouch map[string]time.Time
}

func New(cfg *config.Config, st *store.Store, blobs *storage.Manager, settings *SettingsCache, geo *Geo) *Server {
	return &Server{
		cfg: cfg, st: st, blobs: blobs, settings: settings, geo: geo, started: time.Now(),
		loginLimiter:  auth.NewLimiter(20, 10),
		enrollLimiter: auth.NewLimiter(10, 5),
		apiLimiter:    auth.NewLimiter(6000, 1200),
		pollLimiter:   auth.NewLimiter(60, 30),
		loginFails:    auth.NewFailureTracker(8, 15*time.Minute, 15*time.Minute),
		nonces:        auth.NewNonceCache(2*protocol.MaxClockSkew + time.Minute),
		chunkSem:      make(chan struct{}, cfg.MaxConcurrentChunkWrites),
		lastTouch:     map[string]time.Time{},
	}
}

// --- principal ---

type ctxKey int

const principalKey ctxKey = 1

// Principal is the authenticated caller.
type Principal struct {
	User    *store.User
	Session *store.Session // set for browser sessions
	Device  *store.Device  // set for signed device requests
	// DeclaredBodySHA is the signed body hash for streamed bodies that the
	// handler must verify itself (chunk uploads).
	DeclaredBodySHA string
}

func principal(r *http.Request) *Principal {
	p, _ := r.Context().Value(principalKey).(*Principal)
	return p
}

func (p *Principal) deviceID() *int64 {
	if p == nil || p.Device == nil {
		return nil
	}
	id := p.Device.ID
	return &id
}

// --- JSON helpers ---

type apiError struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *apiError) Error() string { return e.Message }

func errf(status int, code, format string, a ...any) *apiError {
	return &apiError{Status: status, Code: code, Message: fmt.Sprintf(format, a...)}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apiError
	switch {
	case errors.As(err, &ae):
	case errors.Is(err, store.ErrNotFound):
		ae = errf(404, "not_found", "Not found")
	case errors.Is(err, store.ErrExists):
		ae = errf(409, "exists", "An item with that name already exists in this folder")
	case errors.Is(err, store.ErrIsDir):
		ae = errf(409, "is_folder", "A folder with that name already exists")
	case errors.Is(err, store.ErrNotDir):
		ae = errf(409, "not_folder", "%s", err.Error())
	case errors.Is(err, store.ErrCycle):
		ae = errf(409, "cycle", "A folder cannot be moved into itself")
	case errors.Is(err, store.ErrRootNode):
		ae = errf(400, "root", "The root folder cannot be changed")
	case errors.Is(err, store.ErrQuota):
		ae = errf(413, "quota_exceeded", "Storage quota exceeded")
	case errors.Is(err, store.ErrParentGone):
		ae = errf(404, "parent_missing", "Destination folder does not exist")
	case errors.Is(err, storage.ErrInsufficientStorage):
		ae = errf(507, "insufficient_storage", "The server is running low on disk space. Ask your administrator to free space or add storage.")
	case errors.Is(err, storage.ErrLocationUnavailable):
		ae = errf(503, "storage_unavailable", "%s", err.Error())
	case errors.Is(err, context.Canceled):
		ae = errf(499, "cancelled", "Request cancelled")
	default:
		slog.Error("internal error", "err", err, "path", r.URL.Path)
		ae = errf(500, "internal", "Internal server error")
	}
	body := map[string]any{"code": ae.Code, "message": ae.Message}
	if ae.Details != nil {
		body["details"] = ae.Details
	}
	writeJSON(w, ae.Status, map[string]any{"error": body})
}

const maxJSONBody = 2 << 20

func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return errf(413, "too_large", "Request body too large")
		}
		return errf(400, "bad_json", "Invalid request body: %v", err)
	}
	return nil
}

func idParam(r *http.Request, name string) (int64, error) {
	v, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || v <= 0 {
		return 0, errf(400, "bad_id", "Invalid id")
	}
	return v, nil
}

// --- client IP ---

func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	if !s.trusted(addr) {
		return addr.Unmap().String()
	}
	// Walk X-Forwarded-For from the right, skipping trusted proxies.
	xff := r.Header.Values("X-Forwarded-For")
	var hops []string
	for _, h := range xff {
		for _, p := range strings.Split(h, ",") {
			if p = strings.TrimSpace(p); p != "" {
				hops = append(hops, p)
			}
		}
	}
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(hops[i])
		if err != nil {
			break
		}
		if !s.trusted(a) {
			return a.Unmap().String()
		}
	}
	if real := r.Header.Get("X-Real-IP"); real != "" {
		if a, err := netip.ParseAddr(real); err == nil {
			return a.Unmap().String()
		}
	}
	return addr.Unmap().String()
}

func (s *Server) trusted(a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range s.cfg.TrustedProxies {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if a, err := netip.ParseAddr(host); err == nil && s.trusted(a) {
		return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	}
	return false
}

// --- middleware ---

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				slog.Error("panic", "err", rec, "path", r.URL.Path, "stack", string(debug.Stack()))
				if sw.status == 0 {
					writeErr(sw, r, errors.New("panic"))
				}
			}
			lvl := slog.LevelDebug
			if sw.status >= 500 {
				lvl = slog.LevelError
			} else if sw.status >= 400 && sw.status != 401 && sw.status != 404 {
				lvl = slog.LevelInfo
			}
			// chunk uploads are very frequent; keep them at debug level
			slog.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", sw.status, "bytes", sw.bytes, "ms", time.Since(start).Milliseconds(), "ip", s.clientIP(r))
		}()
		next.ServeHTTP(sw, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set(protocol.HeaderServerTime, strconv.FormatInt(time.Now().UnixMilli(), 10))
		if s.isHTTPS(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) rateLimitAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.apiLimiter.Allow(s.clientIP(r)) {
			w.Header().Set("Retry-After", "5")
			writeErr(w, r, errf(429, "rate_limited", "Too many requests, slow down"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

const sessionCookie = "vd_session"
const sessionTTL = 30 * 24 * time.Hour

// authenticate resolves a session cookie or device signature if present.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(protocol.HeaderSignature) != "" || r.Header.Get(protocol.HeaderDevice) != "" {
			p, err := s.authDevice(r)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)))
			return
		}
		if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
			if p := s.authSession(r, c.Value); p != nil {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authSession(r *http.Request, token string) *Principal {
	sess, err := s.st.SessionByID(r.Context(), auth.HashToken(token))
	if err != nil || sess.ExpiresAt < time.Now().UnixMilli() {
		return nil
	}
	u, err := s.st.UserByID(r.Context(), sess.UserID)
	if err != nil || u.Disabled {
		return nil
	}
	if s.shouldTouch("s:" + sess.ID) {
		s.st.TouchSession(r.Context(), sess.ID, s.clientIP(r), time.Now().Add(sessionTTL).UnixMilli())
	}
	return &Principal{User: u, Session: sess}
}

func (s *Server) shouldTouch(key string) bool {
	s.touchMu.Lock()
	defer s.touchMu.Unlock()
	if t, ok := s.lastTouch[key]; ok && time.Since(t) < time.Minute {
		return false
	}
	s.lastTouch[key] = time.Now()
	if len(s.lastTouch) > 50000 {
		s.lastTouch = map[string]time.Time{}
	}
	return true
}

// isStreamedBody reports routes whose body the handler verifies itself.
func isStreamedBody(r *http.Request) bool {
	return r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") && strings.Contains(r.URL.Path, "/chunks/")
}

func (s *Server) authDevice(r *http.Request) (*Principal, error) {
	unauth := func(code, msg string) error { return errf(401, code, "%s", msg) }
	id, err := strconv.ParseInt(r.Header.Get(protocol.HeaderDevice), 10, 64)
	if err != nil || id <= 0 {
		return nil, unauth("bad_signature", "Invalid device credentials")
	}
	dev, err := s.st.Device(r.Context(), id)
	if err != nil {
		return nil, unauth("unknown_device", "Unknown device")
	}
	h := protocol.SignedHeaders{
		DeviceID:   r.Header.Get(protocol.HeaderDevice),
		Timestamp:  r.Header.Get(protocol.HeaderTimestamp),
		Nonce:      r.Header.Get(protocol.HeaderNonce),
		BodySHA256: strings.ToLower(r.Header.Get(protocol.HeaderBodySHA256)),
		Signature:  r.Header.Get(protocol.HeaderSignature),
	}
	pub, err := protocol.DecodePublicKey(dev.PublicKey)
	if err != nil {
		return nil, unauth("bad_signature", "Invalid device credentials")
	}
	ts, err := protocol.Verify(pub, r.Method, r.URL.RequestURI(), h, time.Now())
	if errors.Is(err, protocol.ErrStale) {
		return nil, unauth("clock_skew", "Request timestamp is outside the accepted window; check the device clock")
	}
	if err != nil {
		return nil, unauth("bad_signature", "Invalid request signature")
	}
	// Status checks happen after signature verification so the response
	// does not leak device state to unauthenticated callers.
	switch dev.Status {
	case "approved":
	case "revoked":
		return nil, unauth("device_revoked", "This device has been revoked. Reconnect it from the desktop app.")
	case "pending":
		return nil, errf(403, "device_pending", "This device is waiting for approval")
	default:
		return nil, unauth("device_not_authorised", "This device is not authorised")
	}
	if !s.nonces.Use(dev.KeyFingerprint+"|"+h.Nonce, ts) {
		return nil, unauth("replay", "Request was already used or predates a server restart; retry")
	}
	u, err := s.st.UserByID(r.Context(), dev.UserID)
	if err != nil || u.Disabled {
		return nil, unauth("account_disabled", "The account is disabled")
	}
	p := &Principal{User: u, Device: dev}
	if isStreamedBody(r) {
		p.DeclaredBodySHA = h.BodySHA256
	} else {
		body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxJSONBody))
		if err != nil {
			return nil, errf(413, "too_large", "Request body too large")
		}
		if protocol.SHA256Hex(body) != h.BodySHA256 {
			return nil, errf(400, "body_mismatch", "Request body does not match the signed hash")
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	if s.shouldTouch("d:" + strconv.FormatInt(dev.ID, 10)) {
		s.st.TouchDevice(r.Context(), dev.ID, s.clientIP(r))
	}
	return p, nil
}

func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principal(r)
		if p == nil {
			writeErr(w, r, errf(401, "unauthenticated", "Sign in required"))
			return
		}
		if p.Session != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
			tok := r.Header.Get("X-CSRF-Token")
			if tok == "" || subtle.ConstantTimeCompare([]byte(tok), []byte(p.Session.CSRF)) != 1 {
				writeErr(w, r, errf(403, "csrf", "Missing or invalid CSRF token; reload the page"))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := principal(r); p == nil || p.Session == nil {
			writeErr(w, r, errf(403, "session_required", "This action is only available in the web interface"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireDevice(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := principal(r); p == nil || p.Device == nil {
			writeErr(w, r, errf(403, "device_required", "This endpoint is for desktop clients"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principal(r)
		if p == nil || p.Session == nil || !p.User.IsAdmin() {
			writeErr(w, r, errf(403, "forbidden", "Administrator access required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// activity records a user-visible activity entry (audit=true also shows in
// the admin audit log).
func (s *Server) activity(r *http.Request, userID int64, action, target, details string, audit bool) {
	p := principal(r)
	a := store.Activity{Action: action, Target: target, Details: details, IP: s.clientIP(r), Audit: audit}
	if userID > 0 {
		a.UserID = &userID
	}
	if p != nil {
		a.ActorID = &p.User.ID
		a.DeviceID = p.deviceID()
	}
	s.st.LogActivity(context.WithoutCancel(r.Context()), a)
}

// Handler builds the HTTP router.
func (s *Server) Handler(web http.Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(s.logRequests, s.securityHeaders)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"status": "ok"}) })
	r.Get("/readyz", s.handleReady)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(s.rateLimitAPI, s.authenticate)

		r.Get("/info", s.handleInfo)
		r.Get("/setup/status", s.handleSetupStatus)
		r.Post("/setup", s.handleSetup)
		r.Post("/auth/login", s.handleLogin)
		r.Post("/auth/register", s.handleRegister)
		r.Post("/device/enroll", s.handleEnroll)
		r.Get("/device/enroll/{id}", s.handleEnrollStatus)

		r.Group(func(r chi.Router) {
			r.Use(s.requireUser)
			r.Post("/auth/logout", s.handleLogout)
			r.Get("/auth/me", s.handleMe)

			// files (session or device)
			r.Get("/files", s.handleList)
			r.Get("/files/resolve", s.handleResolve)
			r.Get("/files/search", s.handleSearch)
			r.Get("/files/tags", s.handleTagList)
			r.Get("/files/zip", s.handleZip)
			r.Post("/files/folder", s.handleCreateFolder)
			r.Post("/files/ensure-folder", s.handleEnsureFolder)
			r.Post("/files/move", s.handleBatchMove)
			r.Post("/files/delete", s.handleBatchDelete)
			r.Get("/files/{id}", s.handleGetNode)
			r.Patch("/files/{id}", s.handlePatchNode)
			r.Delete("/files/{id}", s.handleDeleteNode)
			r.Put("/files/{id}/tags", s.handleSetTags)
			r.Get("/files/{id}/content", s.handleContent)
			r.Head("/files/{id}/content", s.handleContent)

			r.Get("/trash", s.handleTrashList)
			r.Post("/trash/{id}/restore", s.handleTrashRestore)
			r.Delete("/trash/{id}", s.handleTrashPurge)
			r.Delete("/trash", s.handleTrashEmpty)

			r.Post("/uploads", s.handleUploadCreate)
			r.Get("/uploads", s.handleUploadList)
			r.Get("/uploads/{id}", s.handleUploadGet)
			r.Put("/uploads/{id}/chunks/{index}", s.handleUploadChunk)
			r.Post("/uploads/{id}/complete", s.handleUploadComplete)
			r.Delete("/uploads/{id}", s.handleUploadCancel)

			r.Get("/automations/reference", s.handleAutomationReference)
			r.Post("/automations/validate", s.handleAutomationValidate)
			r.Post("/automations/dry-run", s.handleAutomationDryRun)

			r.Group(func(r chi.Router) {
				r.Use(s.requireDevice)
				r.Get("/device/me", s.handleDeviceMe)
				r.Put("/device/state", s.handleDeviceState)
				r.Get("/device/automations", s.handleDeviceAutomations)
				r.Post("/device/transfers", s.handleDeviceTransfers)
				r.Post("/device/notifications", s.handleDeviceNotifications)
			})

			r.Group(func(r chi.Router) {
				r.Use(s.requireSession)
				r.Get("/stats", s.handleStats)
				r.Get("/activity", s.handleActivity)
				r.Get("/transfers", s.handleTransfers)
				r.Get("/sync/overview", s.handleSyncOverview)
				r.Get("/notifications", s.handleNotifications)
				r.Post("/notifications/read", s.handleNotificationsRead)

				r.Put("/account/profile", s.handleProfile)
				r.Put("/account/password", s.handlePassword)
				r.Get("/account/sessions", s.handleSessions)
				r.Delete("/account/sessions/{id}", s.handleSessionRevoke)
				r.Post("/account/sessions/revoke-others", s.handleSessionsRevokeOthers)

				r.Get("/devices", s.handleDevices)
				r.Post("/devices/{id}/approve", s.handleDeviceDecision("approved"))
				r.Post("/devices/{id}/reject", s.handleDeviceDecision("rejected"))
				r.Post("/devices/{id}/revoke", s.handleDeviceRevoke)
				r.Patch("/devices/{id}", s.handleDeviceRename)
				r.Delete("/devices/{id}", s.handleDeviceDelete)

				r.Get("/automations", s.handleAutomationList)
				r.Post("/automations", s.handleAutomationCreate)
				r.Get("/automations/templates", s.handleAutomationTemplates)
				r.Get("/automations/{id}", s.handleAutomationGet)
				r.Put("/automations/{id}", s.handleAutomationUpdate)
				r.Delete("/automations/{id}", s.handleAutomationDelete)
				r.Get("/automations/{id}/export", s.handleAutomationExport)

				r.Route("/admin", func(r chi.Router) {
					r.Use(s.requireAdmin)
					r.Get("/overview", s.handleAdminOverview)
					r.Get("/users", s.handleAdminUsers)
					r.Post("/users", s.handleAdminCreateUser)
					r.Patch("/users/{id}", s.handleAdminPatchUser)
					r.Delete("/users/{id}", s.handleAdminDeleteUser)
					r.Post("/users/{id}/revoke-sessions", s.handleAdminRevokeSessions)
					r.Post("/users/{id}/reset-password", s.handleAdminResetPassword)
					r.Post("/users/{id}/recalculate", s.handleAdminRecalc)
					r.Get("/storage", s.handleAdminStorage)
					r.Post("/storage", s.handleAdminCreateStorage)
					r.Patch("/storage/{id}", s.handleAdminPatchStorage)
					r.Delete("/storage/{id}", s.handleAdminDeleteStorage)
					r.Get("/devices", s.handleAdminDevices)
					r.Post("/devices/{id}/revoke", s.handleAdminDeviceRevoke)
					r.Get("/transfers", s.handleAdminTransfers)
					r.Get("/uploads", s.handleAdminUploads)
					r.Delete("/uploads/{id}", s.handleAdminCancelUpload)
					r.Get("/settings", s.handleAdminSettings)
					r.Put("/settings", s.handleAdminSaveSettings)
					r.Get("/health", s.handleAdminHealth)
					r.Get("/audit", s.handleAdminAudit)
					r.Post("/maintenance/cleanup", s.handleAdminCleanup)
				})
			})
		})
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, r, errf(404, "not_found", "Unknown API endpoint"))
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, r, errf(405, "method_not_allowed", "Method not allowed"))
		})
	})
	if web != nil {
		r.Handle("/*", web)
	}
	return r
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.st.DB.PingContext(ctx); err != nil {
		writeJSON(w, 503, map[string]any{"status": "database unavailable"})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ready"})
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	st := s.settings.Get()
	writeJSON(w, 200, map[string]any{
		"name":                 "VaultDock",
		"site_name":            st.SiteName,
		"version":              Version,
		"registration_enabled": st.RegistrationEnabled,
		"chunk_size":           s.cfg.ChunkSize,
		"server_time":          time.Now().UnixMilli(),
	})
}
