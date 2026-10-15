package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vaultdock/vaultdock/internal/auth"
	"github.com/vaultdock/vaultdock/internal/store"
	"github.com/vaultdock/vaultdock/pkg/automation"
	"github.com/vaultdock/vaultdock/pkg/protocol"
)

const maxPendingPerUser = 5

func cleanText(s string, n int) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	if len(s) > n {
		s = s[:n]
	}
	return s
}

func (s *Server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	if !s.enrollLimiter.Allow("enroll:" + s.clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		writeErr(w, r, errf(429, "rate_limited", "Too many connection attempts, wait a minute"))
		return
	}
	var req struct {
		Login         string `json:"login"`
		Password      string `json:"password"`
		DeviceName    string `json:"device_name"`
		OS            string `json:"os"`
		Identifier    string `json:"identifier"`
		PublicKey     string `json:"public_key"`
		ClientVersion string `json:"client_version"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	pub, err := protocol.DecodePublicKey(req.PublicKey)
	if err != nil {
		writeErr(w, r, errf(400, "bad_public_key", "Invalid device public key"))
		return
	}
	req.DeviceName = cleanText(req.DeviceName, 64)
	req.Identifier = cleanText(req.Identifier, 128)
	if req.DeviceName == "" || req.Identifier == "" {
		writeErr(w, r, errf(400, "bad_device", "Device name and identifier are required"))
		return
	}
	u, err := s.checkCredentials(r, req.Login, req.Password)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	n, err := s.st.CountRecentPendingForUser(r.Context(), u.ID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if n >= maxPendingPerUser {
		writeErr(w, r, errf(429, "too_many_pending", "There are already %d pending device requests for this account. Approve or reject them in the web interface first", n))
		return
	}
	pollToken := auth.RandomToken(32)
	ip := s.clientIP(r)
	t := time.Now()
	ttl := time.Duration(s.settings.Get().DeviceRequestTTLMinutes) * time.Minute
	d := &store.Device{
		UserID: u.ID, Name: req.DeviceName, OS: cleanText(req.OS, 100), ClientVersion: cleanText(req.ClientVersion, 32),
		Identifier: req.Identifier, PublicKey: protocol.EncodePublicKey(pub), KeyFingerprint: protocol.KeyFingerprint(pub),
		UserCode: auth.UserCode(), PollTokenHash: auth.HashToken(pollToken), RequestIP: ip, RequestLocation: s.geo.Describe(ip),
		CreatedAt: t.UnixMilli(), ExpiresAt: t.Add(ttl).UnixMilli(),
	}
	if err := s.st.CreateDevice(r.Context(), d); err != nil {
		writeErr(w, r, err)
		return
	}
	_ = s.st.AddNotification(r.Context(), u.ID, store.Notification{
		Title: "New device wants access", Level: "warning", Source: "devices",
		Message: fmt.Sprintf("%s (%s) requested access from %s. Code %s. Approve or reject it under Devices.", d.Name, d.OS, ip, d.UserCode),
	})
	s.activity(r, u.ID, "device.requested", d.Name, fmt.Sprintf("os=%s ip=%s code=%s", d.OS, ip, d.UserCode), true)
	writeJSON(w, 201, map[string]any{
		"request_id": d.ID, "poll_token": pollToken, "user_code": d.UserCode, "expires_at": d.ExpiresAt,
		"poll_interval_seconds": 3, "key_fingerprint": d.KeyFingerprint, "username": u.Username,
	})
}

func (s *Server) handleEnrollStatus(w http.ResponseWriter, r *http.Request) {
	if !s.pollLimiter.Allow("poll:" + s.clientIP(r)) {
		w.Header().Set("Retry-After", "5")
		writeErr(w, r, errf(429, "rate_limited", "Polling too fast"))
		return
	}
	id, err := idParam(r, "id")
	if err != nil {
		writeErr(w, r, err)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	d, err := s.st.Device(r.Context(), id)
	if err != nil || token == "" || d.PollTokenHash == "" || subtle.ConstantTimeCompare([]byte(auth.HashToken(token)), []byte(d.PollTokenHash)) != 1 {
		writeErr(w, r, errf(404, "not_found", "Unknown or finished device request"))
		return
	}
	status := d.Status
	if status == "pending" && d.ExpiresAt <= time.Now().UnixMilli() {
		status = "expired"
		_, _ = s.st.ExpirePendingDevices(r.Context())
	}
	resp := map[string]any{"status": status, "expires_at": d.ExpiresAt}
	if status == "approved" {
		resp["device_id"] = d.ID
	}
	if status != "pending" {
		s.st.ClearPollToken(r.Context(), d.ID)
	}
	writeJSON(w, 200, resp)
}

// --- web device management ---

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	_, _ = s.st.ExpirePendingDevices(r.Context())
	list, err := s.st.ListDevices(r.Context(), principal(r).User.ID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"devices": list})
}

func (s *Server) ownDevice(w http.ResponseWriter, r *http.Request) *store.Device {
	id, err := idParam(r, "id")
	if err != nil {
		writeErr(w, r, err)
		return nil
	}
	d, err := s.st.Device(r.Context(), id)
	if err != nil || d.UserID != principal(r).User.ID {
		writeErr(w, r, store.ErrNotFound)
		return nil
	}
	return d
}

func (s *Server) handleDeviceDecision(status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := principal(r)
		d := s.ownDevice(w, r)
		if d == nil {
			return
		}
		ok, err := s.st.DecideDevice(r.Context(), d.ID, p.User.ID, status, p.User.ID)
		if err != nil {
			writeErr(w, r, err)
			return
		}
		if !ok {
			writeErr(w, r, errf(409, "not_pending", "This request is no longer pending (it may have expired). Ask the device to reconnect"))
			return
		}
		action := "device.approved"
		if status == "rejected" {
			action = "device.rejected"
		}
		s.activity(r, p.User.ID, action, d.Name, "fingerprint "+d.KeyFingerprint, true)
		d2, _ := s.st.Device(r.Context(), d.ID)
		writeJSON(w, 200, map[string]any{"device": d2})
	}
}

func (s *Server) handleDeviceRevoke(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	d := s.ownDevice(w, r)
	if d == nil {
		return
	}
	ok, err := s.st.RevokeDevice(r.Context(), d.ID, p.User.ID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if !ok {
		writeErr(w, r, errf(409, "not_active", "Device is not active"))
		return
	}
	s.cancelDeviceUploads(r, d.ID)
	s.activity(r, p.User.ID, "device.revoked", d.Name, "", true)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) cancelDeviceUploads(r *http.Request, deviceID int64) {
	uploads, err := s.st.ListUploads(r.Context(), 0)
	if err != nil {
		return
	}
	for i := range uploads {
		if uploads[i].DeviceID != nil && *uploads[i].DeviceID == deviceID {
			s.cancelUpload(r.Context(), &uploads[i], "device revoked")
		}
	}
}

func (s *Server) handleDeviceRename(w http.ResponseWriter, r *http.Request) {
	d := s.ownDevice(w, r)
	if d == nil {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	name := cleanText(req.Name, 64)
	if name == "" {
		writeErr(w, r, errf(400, "bad_name", "Name is required"))
		return
	}
	if err := s.st.RenameDevice(r.Context(), d.ID, name); err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleDeviceDelete(w http.ResponseWriter, r *http.Request) {
	d := s.ownDevice(w, r)
	if d == nil {
		return
	}
	if d.Status == "approved" {
		writeErr(w, r, errf(409, "revoke_first", "Revoke the device before removing it"))
		return
	}
	if err := s.st.DeleteDevice(r.Context(), d.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// --- device API ---

func (s *Server) handleDeviceMe(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	u, _ := s.st.UserByID(r.Context(), p.User.ID)
	writeJSON(w, 200, map[string]any{
		"device": p.Device,
		"user":   map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName, "quota_bytes": u.QuotaBytes, "used_bytes": u.UsedBytes},
		"server": map[string]any{"version": Version, "chunk_size": s.cfg.ChunkSize, "max_file_bytes": s.settings.Get().MaxFileBytes, "max_concurrent_chunks": s.cfg.MaxConcurrentChunkWrites, "site_name": s.settings.Get().SiteName},
	})
}

func (s *Server) handleDeviceState(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	raw, err := readLimited(r, 512<<10)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var probe struct {
		ClientVersion string `json:"client_version"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		writeErr(w, r, errf(400, "bad_json", "Invalid JSON"))
		return
	}
	if err := s.st.SetDeviceSyncState(r.Context(), p.Device.ID, raw, cleanText(probe.ClientVersion, 32)); err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func readLimited(r *http.Request, n int64) ([]byte, error) {
	b, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, n))
	if err != nil {
		return nil, errf(413, "too_large", "Request body too large")
	}
	return b, nil
}

func (s *Server) handleDeviceAutomations(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	rows, err := s.st.ListAutomations(r.Context(), p.User.ID, ptrBool(false), true)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	out := []map[string]any{}
	for _, row := range rows {
		a, res := automation.Parse([]byte(row.Definition))
		if !res.Valid() {
			continue
		}
		a.Enabled = row.Enabled
		out = append(out, map[string]any{"id": row.ID, "name": row.Name, "updated_at": row.UpdatedAt, "definition": a})
	}
	writeJSON(w, 200, map[string]any{"automations": out})
}

func ptrBool(b bool) *bool { return &b }

func (s *Server) handleDeviceTransfers(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var req struct {
		Transfers []struct {
			Path   string `json:"path"`
			Size   int64  `json:"size"`
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"transfers"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	if len(req.Transfers) > 200 {
		writeErr(w, r, errf(400, "too_many", "At most 200 entries per report"))
		return
	}
	for _, t := range req.Transfers {
		if t.Status != "failed" && t.Status != "skipped" {
			continue
		}
		_ = s.st.RecordTransfer(r.Context(), store.Transfer{UserID: p.User.ID, DeviceID: p.deviceID(), Path: cleanText(t.Path, 4096), Size: t.Size, Status: t.Status, Error: cleanText(t.Error, 500), Source: "device"})
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleDeviceNotifications(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var req struct {
		Notifications []struct {
			Title   string `json:"title"`
			Message string `json:"message"`
			Level   string `json:"level"`
		} `json:"notifications"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	if len(req.Notifications) > 50 {
		writeErr(w, r, errf(400, "too_many", "At most 50 notifications per request"))
		return
	}
	for _, n := range req.Notifications {
		lvl := n.Level
		switch lvl {
		case "info", "success", "warning", "error":
		default:
			lvl = "info"
		}
		title := cleanText(n.Title, 200)
		if title == "" {
			continue
		}
		_ = s.st.AddNotification(r.Context(), p.User.ID, store.Notification{Title: title, Message: cleanText(n.Message, 2000), Level: lvl, Source: "automation:" + p.Device.Name})
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
