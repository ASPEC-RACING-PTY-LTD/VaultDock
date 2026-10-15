import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowUpCircle, CheckCircle2, Cpu, Database, HardDrive, KeyRound, Monitor, MoreHorizontal, Plus, RefreshCw, Settings, Shield, ShieldOff, Trash2, UserPlus, Users, XCircle } from 'lucide-react'
import { del, errorMessage, get, patch, post, put } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { formatBytes, formatDate, formatDuration, timeAgo } from '../../lib/format'
import { Badge, Button, cx, EmptyState, ErrorState, Field, IconButton, Menu, Modal, PageHeader, PageLoader, ProgressBar, Stat, Tabs, Toggle, useUI } from '../../components/ui'
import { TransfersTable } from '../Sync'
import { describe } from '../Activity'
import { UpdateBanner, UpdatesTab } from './Updates'

const tabs = [
  { to: '', label: 'Overview', icon: Activity },
  { to: 'users', label: 'Users', icon: Users },
  { to: 'storage', label: 'Storage', icon: HardDrive },
  { to: 'devices', label: 'Devices', icon: Monitor },
  { to: 'transfers', label: 'Transfers', icon: RefreshCw },
  { to: 'settings', label: 'Settings', icon: Settings },
  { to: 'health', label: 'System health', icon: Cpu },
  { to: 'updates', label: 'Updates', icon: ArrowUpCircle },
  { to: 'audit', label: 'Audit log', icon: Shield },
]

const GB = 1024 ** 3

function QuotaInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [unlimited, setUnlimited] = useState(value === 0)
  const [gb, setGb] = useState(value ? +(value / GB).toFixed(2) : 100)
  useEffect(() => onChange(unlimited ? 0 : Math.round(gb * GB)), [unlimited, gb])
  return (
    <div className="space-y-2">
      <Toggle checked={unlimited} onChange={setUnlimited} label="Unlimited" description="Limited only by free disk space" />
      {!unlimited && (
        <div className="flex items-center gap-2">
          <input className="input" type="number" min={0.01} step="any" value={gb} onChange={(e) => setGb(Number(e.target.value))} />
          <span className="text-sm text-slate-500">GB</span>
        </div>
      )}
    </div>
  )
}

function Overview() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-overview'], queryFn: () => get('/admin/overview'), refetchInterval: 15_000 })
  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const s = data.stats
  return (
    <div className="space-y-6">
      <UpdateBanner />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Users" value={s.users} sub={`${s.active_users} active`} icon={<Users className="size-5" />} />
        <Stat label="Stored" value={formatBytes(s.logical_bytes)} sub={`${formatBytes(s.physical_bytes)} on disk after deduplication`} icon={<Database className="size-5" />} tone="sky" />
        <Stat label="Devices" value={s.devices} sub={s.pending_devices ? `${s.pending_devices} pending approval` : 'none pending'} icon={<Monitor className="size-5" />} tone={s.pending_devices ? 'amber' : 'green'} />
        <Stat label="Open uploads" value={s.open_uploads} sub={`${data.transfers.failed_24h} failed in 24h`} icon={<RefreshCw className="size-5" />} tone={data.transfers.failed_24h ? 'red' : 'brand'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card p-6">
          <h3 className="mb-4 font-semibold">Storage devices</h3>
          <div className="space-y-5">
            {data.locations.map((l: any) => (
              <LocationBar key={l.id} l={l} />
            ))}
          </div>
        </div>
        <div className="card p-6">
          <h3 className="mb-4 font-semibold">Recent security events</h3>
          <div className="space-y-2">
            {data.recent_audit.map((a: any) => (
              <div key={a.id} className="flex justify-between gap-3 text-sm">
                <span className="truncate">
                  <span className="font-medium">{describe(a)}</span> <span className="text-slate-500">{a.target}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            VaultDock {data.version} · up {formatDuration(data.uptime_seconds)}
          </p>
        </div>
      </div>
    </div>
  )
}

function LocationBar({ l }: { l: any }) {
  const used = l.total_bytes - l.available_bytes
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <HardDrive className="size-4 text-slate-400" />
          {l.name} {l.is_default && <Badge tone="violet">default</Badge>} {!l.enabled && <Badge>disabled</Badge>}
          {!l.healthy ? <Badge tone="red">unavailable</Badge> : l.low_space ? <Badge tone="amber">low space</Badge> : null}
        </span>
        <span className="text-xs text-slate-500">{l.healthy ? `${formatBytes(l.available_bytes)} free of ${formatBytes(l.total_bytes)}` : ''}</span>
      </div>
      {l.healthy ? <ProgressBar value={l.total_bytes ? (used / l.total_bytes) * 100 : 0} tone={l.low_space ? 'red' : used / l.total_bytes > 0.8 ? 'amber' : 'brand'} /> : <div className="text-xs text-rose-600">{l.problem}</div>}
      <div className="mt-1 font-mono text-[11px] text-slate-400">
        {l.path} · VaultDock data {formatBytes(l.stored_bytes)} · reserve {formatBytes(l.reserve_bytes)}
        {l.pending_bytes > 0 && ` · ${formatBytes(l.pending_bytes)} incoming`}
      </div>
    </div>
  )
}

function UsersTab() {
  const me = useUser()
  const qc = useQueryClient()
  const { toast, confirm } = useUI()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-users'], queryFn: () => get('/admin/users') })
  const locs = useQuery({ queryKey: ['admin-storage'], queryFn: () => get('/admin/storage') })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [resetting, setResetting] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const [busy, setBusy] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast('success', ok)
      refresh()
      return true
    } catch (e) {
      toast('error', 'Action failed', errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const locName = (id: number) => locs.data?.locations.find((l: any) => l.id === id)?.name ?? '-'

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          variant="primary"
          icon={<UserPlus className="size-4" />}
          onClick={() => {
            setForm({ username: '', email: '', password: '', role: 'user', quota_bytes: 0 })
            setCreating(true)
          }}
        >
          Add user
        </Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
            <tr>
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Usage</th>
              <th className="hidden px-4 py-2.5 lg:table-cell">Storage</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.users.map((u: any) => (
              <tr key={u.id} className={cx('border-b border-slate-100 last:border-0 dark:border-slate-800', u.disabled && 'opacity-60')}>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {u.display_name || u.username} {u.id === me.id && <Badge>you</Badge>} {u.disabled && <Badge tone="red">disabled</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.username}
                    {u.email && ` · ${u.email}`}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={u.role === 'admin' ? 'violet' : 'slate'}>{u.role}</Badge>
                </td>
                <td className="w-56 px-4 py-3">
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {formatBytes(u.used_bytes)} {u.quota_bytes > 0 ? `of ${formatBytes(u.quota_bytes)}` : '· unlimited'}
                  </div>
                  {u.quota_bytes > 0 && <ProgressBar value={(u.used_bytes / u.quota_bytes) * 100} className="mt-1 h-1.5" tone={u.used_bytes / u.quota_bytes > 0.9 ? 'red' : 'brand'} />}
                </td>
                <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">{locName(u.location_id)}</td>
                <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">{timeAgo(u.last_login_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Menu
                    trigger={(o) => (
                      <IconButton label="Actions" onClick={o}>
                        <MoreHorizontal className="size-4" />
                      </IconButton>
                    )}
                    items={[
                      { label: 'Edit user, quota & storage', icon: <Settings className="size-4" />, onClick: () => (setForm({ email: u.email, display_name: u.display_name, role: u.role, quota_bytes: u.quota_bytes, location_id: u.location_id }), setEditing(u)) },
                      { label: 'Reset password', icon: <KeyRound className="size-4" />, onClick: () => (setForm({ password: '' }), setResetting(u)) },
                      { label: 'Sign out all sessions', icon: <ShieldOff className="size-4" />, onClick: () => act(() => post(`/admin/users/${u.id}/revoke-sessions`), 'Sessions revoked') },
                      { label: 'Recalculate usage', icon: <RefreshCw className="size-4" />, onClick: () => act(() => post(`/admin/users/${u.id}/recalculate`), 'Usage recalculated') },
                      { label: u.disabled ? 'Enable account' : 'Disable account', icon: <Shield className="size-4" />, disabled: u.id === me.id, onClick: () => act(() => patch(`/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'Account enabled' : 'Account disabled; sessions signed out') },
                      'divider',
                      {
                        label: 'Delete user and files',
                        icon: <Trash2 className="size-4" />,
                        danger: true,
                        disabled: u.id === me.id,
                        onClick: async () => {
                          const ok = await confirm({ title: `Permanently delete ${u.username}?`, message: `This deletes the account, its devices and all ${formatBytes(u.used_bytes)} of stored files. This cannot be undone. To keep the files, disable the account instead.`, confirmLabel: 'Delete permanently', requireText: u.username })
                          if (ok) act(() => del(`/admin/users/${u.id}`, { confirm_username: u.username }), 'User deleted')
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add user"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={async () => (await act(() => post('/admin/users', form), 'User created')) && setCreating(false)}>
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <input className="input" value={form.username ?? ''} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Email (optional)">
              <input className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
          <Field label="Initial password" hint="At least 10 characters. Share it securely; the user can change it in Account settings.">
            <input className="input" type="text" autoComplete="off" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>
          <Field label="Storage quota">
            <QuotaInput value={form.quota_bytes ?? 0} onChange={(v) => setForm((f: any) => ({ ...f, quota_bytes: v }))} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.username}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={async () => (await act(() => patch(`/admin/users/${editing.id}`, form), 'User updated')) && setEditing(null)}>
              Save changes
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name">
                <input className="input" value={form.display_name ?? ''} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </div>
            <Field label="Role">
              <select className="input" value={form.role} disabled={editing.id === me.id} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </Field>
            <Field label="Storage quota" hint={`Currently using ${formatBytes(editing.used_bytes)}. Lowering the quota below usage blocks new uploads but keeps existing files.`}>
              <QuotaInput value={form.quota_bytes ?? 0} onChange={(v) => setForm((f: any) => ({ ...f, quota_bytes: v }))} />
            </Field>
            <Field label="Storage location for new uploads" hint="Existing files stay where they are.">
              <select className="input" value={form.location_id ?? ''} onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}>
                {(locs.data?.locations ?? []).map((l: any) => (
                  <option key={l.id} value={l.id} disabled={!l.enabled}>
                    {l.name} ({l.path})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!resetting}
        onClose={() => setResetting(null)}
        title={`Reset password for ${resetting?.username}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={async () => (await act(() => post(`/admin/users/${resetting.id}/reset-password`, { password: form.password }), 'Password reset; sessions signed out')) && setResetting(null)}>
              Reset password
            </Button>
          </>
        }
      >
        <Field label="New password" hint="At least 10 characters. All of the user's browser sessions are signed out.">
          <input className="input" type="text" autoComplete="off" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
      </Modal>
    </div>
  )
}

function StorageTab() {
  const qc = useQueryClient()
  const { toast, confirm } = useUI()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-storage'], queryFn: () => get('/admin/storage'), refetchInterval: 20_000 })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-storage'] })
  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const save = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn()
      toast('success', ok)
      refresh()
      setAdding(false)
      setEditing(null)
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
    }
  }
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600 sm:flex-row sm:items-center dark:bg-slate-900 dark:text-slate-300">
        <span className="flex-1">
          Storage locations are directories on HDDs, SSDs or mounted volumes. New locations must be inside the allowed roots: <code className="font-mono text-xs">{(data.allowed_roots ?? []).join(', ') || 'any path'}</code>. With Docker, mount the disk into the container under one of these roots first.
        </span>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => (setForm({ name: '', path: (data.allowed_roots?.[0] ?? '') + '/', reserve_bytes: 10 * GB, is_default: false }), setAdding(true))}>
          Add location
        </Button>
      </div>
      <div className="space-y-4">
        {data.locations.map((l: any) => (
          <div key={l.id} className="card p-5">
            <LocationBar l={l} />
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>
                {l.blob_count.toLocaleString()} stored objects · {l.user_count} user(s) assigned
              </span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => (setForm({ name: l.name, reserve_bytes: l.reserve_bytes, enabled: l.enabled, is_default: l.is_default }), setEditing(l))}>
                  Edit
                </Button>
                {!l.is_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-600"
                    disabled={l.blob_count > 0 || l.user_count > 0}
                    title={l.blob_count > 0 ? 'Locations holding files cannot be removed' : undefined}
                    onClick={async () => (await confirm({ title: `Remove ${l.name}?`, message: 'The location is removed from VaultDock. No files on the disk are deleted.', confirmLabel: 'Remove' })) && save(() => del(`/admin/storage/${l.id}`), 'Location removed')}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add storage location"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => save(() => post('/admin/storage', form), 'Location added')}>
              Add location
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" placeholder="Media HDD" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Path inside the server/container" hint="The directory must exist and be writable by VaultDock. VaultDock creates blobs/ and tmp/ inside it.">
            <input className="input font-mono" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
          </Field>
          <Field label="Keep free (reserve)" hint="Uploads are refused when free space would drop below this.">
            <div className="flex items-center gap-2">
              <input className="input" type="number" min={0} value={+(form.reserve_bytes / GB).toFixed(2)} onChange={(e) => setForm({ ...form, reserve_bytes: Math.round(Number(e.target.value) * GB) })} />
              <span className="text-sm text-slate-500">GB</span>
            </div>
          </Field>
          <Toggle checked={form.is_default} onChange={(v) => setForm({ ...form, is_default: v })} label="Use for new users by default" />
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => save(() => patch(`/admin/storage/${editing.id}`, form), 'Location updated')}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Keep free (reserve)">
            <div className="flex items-center gap-2">
              <input className="input" type="number" min={0} value={+((form.reserve_bytes ?? 0) / GB).toFixed(2)} onChange={(e) => setForm({ ...form, reserve_bytes: Math.round(Number(e.target.value) * GB) })} />
              <span className="text-sm text-slate-500">GB</span>
            </div>
          </Field>
          <Toggle checked={!!form.enabled} disabled={editing?.is_default} onChange={(v) => setForm({ ...form, enabled: v })} label="Accept new uploads" description="Disabled locations still serve existing files." />
          <Toggle checked={!!form.is_default} disabled={editing?.is_default} onChange={(v) => setForm({ ...form, is_default: v })} label="Default location for new users" />
        </div>
      </Modal>
    </div>
  )
}

function DevicesTab() {
  const qc = useQueryClient()
  const { toast, confirm } = useUI()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-devices'], queryFn: () => get('/admin/devices'), refetchInterval: 15_000 })
  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const tone = { pending: 'amber', approved: 'green', rejected: 'red', revoked: 'red', expired: 'slate' } as any
  return (
    <div className="card overflow-x-auto">
      {data.devices.length === 0 ? (
        <EmptyState icon={<Monitor className="size-6" />} title="No devices" />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
            <tr>
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">Owner</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.devices.map((d: any) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    {d.os} · {d.key_fingerprint}
                  </div>
                </td>
                <td className="px-4 py-2.5">{d.username}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={tone[d.status]}>{d.status === 'pending' && d.expires_at < Date.now() ? 'expired' : d.status}</Badge>
                </td>
                <td className="hidden px-4 py-2.5 text-xs text-slate-500 md:table-cell">
                  {timeAgo(d.last_seen_at)} {d.last_ip && `· ${d.last_ip}`}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {(d.status === 'approved' || d.status === 'pending') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={async () => {
                        if (!(await confirm({ title: `Revoke ${d.name}?`, message: `The device owned by ${d.username} loses access immediately.`, confirmLabel: 'Revoke' }))) return
                        try {
                          await post(`/admin/devices/${d.id}/revoke`)
                          qc.invalidateQueries({ queryKey: ['admin-devices'] })
                        } catch (e) {
                          toast('error', 'Could not revoke', errorMessage(e))
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TransfersTab() {
  const [tab, setTab] = useState<'active' | 'failed' | ''>('active')
  const qc = useQueryClient()
  const { toast } = useUI()
  const uploads = useQuery({ queryKey: ['admin-uploads'], queryFn: () => get('/admin/uploads'), refetchInterval: 5000, enabled: tab === 'active' })
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'active', label: 'Active uploads' },
            { id: 'failed', label: 'Failed' },
            { id: '', label: 'All transfers' },
          ]}
        />
      </div>
      {tab === 'active' ? (
        uploads.isLoading ? (
          <PageLoader />
        ) : (uploads.data?.uploads ?? []).length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" />} title="No active uploads" />
        ) : (
          (uploads.data?.uploads ?? []).map((u: any) => (
            <div key={u.id} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.path}</div>
                <div className="text-xs text-slate-500">
                  {u.username} · {u.device_name || 'browser'} · updated {timeAgo(u.updated_at)} · expires {timeAgo(u.expires_at)}
                </div>
                <ProgressBar value={u.size ? (u.bytes_received / u.size) * 100 : 0} className="mt-1.5 h-1.5" />
              </div>
              <span className="text-xs text-slate-500">
                {formatBytes(u.bytes_received)} / {formatBytes(u.size)}
              </span>
              <IconButton
                label="Cancel upload"
                onClick={async () => {
                  try {
                    await del(`/admin/uploads/${u.id}`)
                    qc.invalidateQueries({ queryKey: ['admin-uploads'] })
                  } catch (e) {
                    toast('error', 'Could not cancel', errorMessage(e))
                  }
                }}
              >
                <XCircle className="size-4" />
              </IconButton>
            </div>
          ))
        )
      ) : (
        <TransfersTable status={tab} admin />
      )}
    </div>
  )
}

function SettingsTab() {
  const { toast } = useUI()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-settings'], queryFn: () => get('/admin/settings') })
  const [s, setS] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (data) setS(data.settings)
  }, [data])
  if (isLoading || !s) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const save = async () => {
    setBusy(true)
    try {
      await put('/admin/settings', s)
      toast('success', 'Settings saved')
    } catch (e) {
      toast('error', 'Could not save settings', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) })
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="card space-y-6 p-6">
        <Field label="Site name">
          <input className="input" value={s.site_name} onChange={(e) => setS({ ...s, site_name: e.target.value })} />
        </Field>
        <Toggle checked={s.registration_enabled} onChange={(v) => setS({ ...s, registration_enabled: v })} label="Allow self-registration" description="When off, only administrators can create accounts. Keep off for internet-facing servers unless you trust everyone who can reach it." />
        <Field label="Default quota for new users">
          <QuotaInput value={s.default_quota_bytes} onChange={(v) => setS((x: any) => ({ ...x, default_quota_bytes: v }))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximum file size (GB, 0 = unlimited)">
            <input className="input" type="number" min={0} step="any" value={+(s.max_file_bytes / GB).toFixed(2)} onChange={(e) => setS({ ...s, max_file_bytes: Math.round(Number(e.target.value) * GB) })} />
          </Field>
          <Field label="Always keep free on every disk (GB)" hint="Hard floor that protects the host from filling up.">
            <input className="input" type="number" min={0} step="any" value={+(s.min_free_bytes / GB).toFixed(2)} onChange={(e) => setS({ ...s, min_free_bytes: Math.round(Number(e.target.value) * GB) })} />
          </Field>
          <Field label="Trash retention (days, 0 = keep)">
            <input className="input" type="number" min={0} value={s.trash_retention_days} onChange={num('trash_retention_days')} />
          </Field>
          <Field label="Activity retention (days)">
            <input className="input" type="number" min={7} value={s.activity_retention_days} onChange={num('activity_retention_days')} />
          </Field>
          <Field label="Device request expiry (minutes)">
            <input className="input" type="number" min={2} max={1440} value={s.device_request_ttl_minutes} onChange={num('device_request_ttl_minutes')} />
          </Field>
        </div>
        <Toggle checked={s.keep_replaced_versions} onChange={(v) => setS({ ...s, keep_replaced_versions: v })} label="Keep replaced versions in trash" description="When a synced file changes, the previous version moves to the owner's trash instead of being deleted immediately." />
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={save}>
            Save settings
          </Button>
        </div>
      </div>
      <div className="card h-fit p-6">
        <h3 className="mb-3 font-semibold">Server configuration</h3>
        <p className="mb-4 text-xs text-slate-500">Set through environment variables in the .env file. Restart VaultDock after changing them.</p>
        <dl className="space-y-2 text-sm">
          {Object.entries(data.config).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-slate-500">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-right font-mono text-xs break-all">{Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'chunk_size' ? formatBytes(v as number) : String(v || '-')}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function HealthTab() {
  const [deep, setDeep] = useState(false)
  const qc = useQueryClient()
  const { toast } = useUI()
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['admin-health', deep], queryFn: () => get(`/admin/health${deep ? '?deep=1' : ''}`), refetchInterval: 15_000 })
  const [cleaning, setCleaning] = useState(false)
  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className={cx('flex items-center gap-3 rounded-2xl p-4', data.status === 'healthy' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200')}>
        {data.status === 'healthy' ? <CheckCircle2 className="size-6" /> : <AlertTriangle className="size-6" />}
        <div className="flex-1">
          <div className="font-semibold">{data.status === 'healthy' ? 'All systems healthy' : 'Attention needed'}</div>
          {data.problems?.length > 0 && <div className="text-sm">{data.problems.join(' · ')}</div>}
        </div>
        <Button size="sm" loading={isFetching} onClick={() => (setDeep(true), refetch())}>
          Run integrity check
        </Button>
        <Button
          size="sm"
          loading={cleaning}
          onClick={async () => {
            setCleaning(true)
            try {
              const r = await post('/admin/maintenance/cleanup')
              toast('success', 'Maintenance complete', Object.entries(r).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', '))
              qc.invalidateQueries({ queryKey: ['admin-health'] })
            } catch (e) {
              toast('error', 'Maintenance failed', errorMessage(e))
            } finally {
              setCleaning(false)
            }
          }}
        >
          Run maintenance
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Uptime" value={formatDuration(data.uptime_seconds)} sub={`VaultDock ${data.version} · ${data.go}`} icon={<Activity className="size-5" />} />
        <Stat label="Memory" value={formatBytes(data.memory.heap_alloc)} sub={`${formatBytes(data.memory.sys)} reserved · ${data.goroutines} goroutines`} icon={<Cpu className="size-5" />} tone="sky" />
        <Stat label="Database" value={formatBytes(data.database.size_bytes)} sub={`schema v${data.database.schema_version} · integrity ${data.database.integrity}`} icon={<Database className="size-5" />} tone={data.database.ok ? 'green' : 'red'} />
        <Stat label="Upload slots" value={`${data.chunk_slots.in_use} / ${data.chunk_slots.capacity}`} sub="concurrent chunk writes" icon={<RefreshCw className="size-5" />} />
      </div>
      <div className="card p-6">
        <h3 className="mb-4 font-semibold">Disks</h3>
        <div className="space-y-5">
          {data.locations.map((l: any) => (
            <LocationBar key={l.id} l={l} />
          ))}
          <div>
            <div className="mb-1.5 flex justify-between text-sm">
              <span className="font-medium">Application state (database)</span>
              <span className="text-xs text-slate-500">
                {formatBytes(data.state_volume.available)} free of {formatBytes(data.state_volume.total)}
              </span>
            </div>
            <ProgressBar value={data.state_volume.total ? ((data.state_volume.total - data.state_volume.available) / data.state_volume.total) * 100 : 0} />
            <div className="mt-1 font-mono text-[11px] text-slate-400">{data.database.path}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuditTab() {
  const [filter, setFilter] = useState('')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-audit', filter], queryFn: () => get(`/admin/audit${filter ? `?action=${filter}` : ''}`) })
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <select className="input w-56" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All events</option>
          <option value="auth.">Sign-ins</option>
          <option value="device.">Devices</option>
          <option value="admin.">Administration</option>
          <option value="account.">Account changes</option>
        </select>
      </div>
      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">User</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Details</th>
                <th className="px-4 py-2.5">IP</th>
                <th className="px-4 py-2.5">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a: any) => (
                <tr key={a.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2.5">
                    <div className={cx('font-medium', a.action === 'auth.failed' && 'text-rose-600')}>{describe(a)}</div>
                    <div className="text-xs break-all text-slate-500">{a.target}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {a.actor_name || '-'}
                    {a.username && a.username !== a.actor_name && <span className="text-slate-500"> → {a.username}</span>}
                  </td>
                  <td className="hidden max-w-xs px-4 py-2.5 text-xs break-words text-slate-500 md:table-cell">{a.details}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{a.ip}</td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500" title={formatDate(a.created_at)}>
                    {timeAgo(a.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin console" description="Manage users, storage and the health of this VaultDock server." icon={<Shield className="size-5" />} />
      <nav className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to === '' ? '/admin' : `/admin/${t.to}`} end={t.to === ''} className={({ isActive }) => cx('-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap', isActive ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}>
            <t.icon className="size-4" />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="users" element={<UsersTab />} />
        <Route path="storage" element={<StorageTab />} />
        <Route path="devices" element={<DevicesTab />} />
        <Route path="transfers" element={<TransfersTab />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="health" element={<HealthTab />} />
        <Route path="updates" element={<UpdatesTab />} />
        <Route path="audit" element={<AuditTab />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  )
}
