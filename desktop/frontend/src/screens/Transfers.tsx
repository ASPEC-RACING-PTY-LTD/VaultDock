import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ListHistory, ListQueue, RetryFailed } from '../../wailsjs/go/main/App'
import type { engine, state } from '../../wailsjs/go/models'
import { Badge, Button, EmptyState, Tabs, useUI } from '../ui'
import { ActiveList } from './Overview'
import { errMsg, formatBytes, timeAgo } from '../lib'

type Tab = 'active' | 'queued' | 'failed' | 'completed'

export function TransfersScreen({ snap }: { snap: engine.Snapshot | null }) {
  const [tab, setTab] = useState<Tab>('active')
  const [queue, setQueue] = useState<state.Item[]>([])
  const [failed, setFailed] = useState<state.Item[]>([])
  const [history, setHistory] = useState<state.HistoryEntry[]>([])
  const { toast } = useUI()
  const load = () => {
    ListQueue('pending').then(setQueue)
    ListQueue('failed').then(setFailed)
    ListHistory('').then(setHistory)
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const retry = async (id: number) => {
    try {
      const n = await RetryFailed(id)
      toast('success', `Retrying ${n} file(s)`)
      load()
    } catch (e) {
      toast('error', 'Retry failed', errMsg(e))
    }
  }
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="text-sm text-slate-500">Uploads resume automatically after network drops, restarts and crashes.</p>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'active', label: 'Active', count: snap?.active.length },
            { id: 'queued', label: 'Queued', count: queue.length },
            { id: 'failed', label: 'Failed', count: failed.length },
            { id: 'completed', label: 'History' },
          ]}
        />
      </div>
      <div className="card overflow-hidden">
        {tab === 'active' && <ActiveList items={snap?.active ?? []} />}
        {tab === 'queued' &&
          (queue.length === 0 ? (
            <EmptyState icon={<RotateCcw className="size-6" />} title="Queue is empty" />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="max-w-md truncate px-4 py-2">
                      <div className="truncate font-medium">{q.rel_path}</div>
                      <div className="truncate text-xs text-slate-500">
                        → {q.remote_dir === '/' ? '' : q.remote_dir}/{q.remote_name}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatBytes(q.size)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{q.error ? <span className="text-amber-600">{q.error}</span> : q.next_at > Date.now() + 1000 ? `starts ${timeAgo(q.next_at)}` : 'waiting for a slot'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === 'failed' &&
          (failed.length === 0 ? (
            <EmptyState icon={<RotateCcw className="size-6" />} title="No failed transfers" />
          ) : (
            <>
              <div className="flex justify-end border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => retry(0)}>
                  Retry all
                </Button>
              </div>
              {failed.map((q) => (
                <div key={q.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{q.rel_path}</div>
                    <div className="text-xs break-words text-rose-600">{q.error}</div>
                    <div className="text-xs text-slate-500">{q.attempts} attempt(s)</div>
                  </div>
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => retry(q.id)}>
                    Retry
                  </Button>
                </div>
              ))}
            </>
          ))}
        {tab === 'completed' &&
          (history.length === 0 ? (
            <EmptyState icon={<RotateCcw className="size-6" />} title="No transfers yet" />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="max-w-md px-4 py-2">
                      <div className="truncate font-medium">{h.rel_path}</div>
                      <div className="truncate text-xs text-slate-500">→ {h.remote_path}</div>
                      {h.error && <div className="text-xs text-rose-600">{h.error}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={h.status === 'failed' ? 'red' : h.result === 'deduplicated' ? 'violet' : h.result === 'unchanged' ? 'slate' : 'green'}>{h.status === 'failed' ? 'failed' : h.result || h.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatBytes(h.size)}</td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-500">{timeAgo(h.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  )
}
