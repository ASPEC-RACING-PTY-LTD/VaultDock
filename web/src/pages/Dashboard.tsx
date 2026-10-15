import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, CheckCircle2, CloudUpload, Files, FolderOpen, HardDrive, Monitor, Workflow } from 'lucide-react'
import { get } from '../lib/api'
import { useUser } from '../lib/auth'
import { formatBytes, pluralize, timeAgo } from '../lib/format'
import { Button, ErrorState, PageHeader, PageLoader, ProgressBar, Stat } from '../components/ui'
import { FileIcon } from '../components/FileIcon'

const kindColors: Record<string, string> = { video: 'bg-violet-500', image: 'bg-pink-500', document: 'bg-sky-500', audio: 'bg-teal-500', archive: 'bg-orange-500', other: 'bg-slate-400' }
const kindLabels: Record<string, string> = { video: 'Videos', image: 'Images', document: 'Documents', audio: 'Audio', archive: 'Archives', other: 'Other' }

export function DashboardPage() {
  const user = useUser()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['stats'], queryFn: () => get('/stats'), refetchInterval: 30_000 })
  const { data: sync } = useQuery({ queryKey: ['sync-overview'], queryFn: () => get('/sync/overview'), refetchInterval: 30_000 })
  if (isLoading) return <PageLoader />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const used = data.usage.used_bytes as number
  const quota = data.usage.quota_bytes as number
  const byKind: Record<string, number> = data.files.bytes_by_kind ?? {}
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1])
  const totalKind = kinds.reduce((a, [, v]) => a + v, 0)
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const devicesOnline = (sync?.devices ?? []).filter((d: any) => d.online).length

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user.display_name || user.username}`}
        description="Here's what's happening across your storage and devices."
        actions={
          <Link to="/files">
            <Button variant="primary" icon={<FolderOpen className="size-4" />}>
              Open files
            </Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Storage used" value={formatBytes(used)} sub={quota > 0 ? `of ${formatBytes(quota)} quota` : data.device_available_bytes !== undefined ? `${formatBytes(data.device_available_bytes)} free on server` : 'No quota set'} icon={<HardDrive className="size-5" />} />
        <Stat label="Files" value={data.files.files.toLocaleString()} sub={pluralize(data.files.folders, 'folder')} icon={<Files className="size-5" />} tone="sky" />
        <Stat label="Uploaded (24h)" value={data.transfers.completed_24h.toLocaleString()} sub={`${formatBytes(data.transfers.bytes_24h)} transferred`} icon={<CloudUpload className="size-5" />} tone="green" />
        <Stat label="Devices" value={`${data.devices.approved}`} sub={`${devicesOnline} online${data.devices.pending ? ` · ${data.devices.pending} pending` : ''}`} icon={<Monitor className="size-5" />} tone={data.devices.pending ? 'amber' : 'brand'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold">Storage overview</h2>
            {quota > 0 && <span className="text-sm text-slate-500">{Math.round((used / quota) * 100)}% of quota</span>}
          </div>
          {quota > 0 && <ProgressBar value={(used / quota) * 100} tone={used / quota > 0.9 ? 'red' : used / quota > 0.75 ? 'amber' : 'brand'} className="mb-6 h-3" />}
          {totalKind > 0 ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                {kinds.map(([k, v]) => (
                  <div key={k} className={kindColors[k]} style={{ width: `${(v / totalKind) * 100}%` }} title={`${kindLabels[k]}: ${formatBytes(v)}`} />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {kinds.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className={`size-3 rounded-full ${kindColors[k]}`} />
                    <div>
                      <div className="text-sm font-medium">{kindLabels[k]}</div>
                      <div className="text-xs text-slate-500">
                        {formatBytes(v)} · {pluralize(data.files.count_by_kind[k] ?? 0, 'file')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">No files yet. Upload files in the browser or connect the desktop app to start syncing.</p>
          )}
          {data.files.trash_bytes > 0 && (
            <p className="mt-5 text-xs text-slate-500">
              Trash holds {formatBytes(data.files.trash_bytes)} that still counts towards your usage. <Link to="/trash" className="text-brand-600 hover:underline">Review trash</Link>
            </p>
          )}
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Synchronisation</h2>
            <Link to="/sync" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
              Details <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Active transfers</span>
              <span className="font-medium">{data.transfers.active}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Failed (24h)</span>
              <span className={data.transfers.failed_24h ? 'font-medium text-rose-600' : 'font-medium'}>{data.transfers.failed_24h}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Total completed</span>
              <span className="font-medium">{data.transfers.completed_total.toLocaleString()}</span>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {(sync?.devices ?? []).slice(0, 4).map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                <span className={`size-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-slate-500">{d.online ? 'Online' : `Last seen ${timeAgo(d.last_seen_at)}`}</div>
                </div>
              </div>
            ))}
            {!(sync?.devices ?? []).length && (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
                No devices connected yet. Install the VaultDock desktop app and sign in with this server's address.
              </div>
            )}
          </div>
          {data.transfers.failed_24h > 0 ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-rose-600">
              <AlertTriangle className="size-4" /> Some transfers failed recently.
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-600">
              <CheckCircle2 className="size-4" /> No failed transfers in the last 24 hours.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <h2 className="mb-4 text-base font-semibold">Recently added</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing here yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recent.map((f: any) => (
                <Link key={f.id} to={`/files/${f.parent_id}?select=${f.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <FileIcon mime={f.mime} isDir={false} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="truncate text-xs text-slate-500">{f.path}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{formatBytes(f.size)}</div>
                    <div>{timeAgo(f.created_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card flex flex-col p-6">
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Workflow className="size-5" />
          </div>
          <h2 className="text-base font-semibold">Automate your uploads</h2>
          <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">Build visual workflows that sort clips by game, skip temporary files, tag uploads and notify you when something goes wrong.</p>
          <Link to="/automations" className="mt-4">
            <Button className="w-full">Open automation builder</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
