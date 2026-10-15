import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, Workflow } from 'lucide-react'
import { ListAutomations, OpenWebInterface, RefreshAutomations } from '../../wailsjs/go/main/App'
import type { engine } from '../../wailsjs/go/models'
import { Badge, Button, EmptyState } from '../ui'

export function AutomationsScreen() {
  const [list, setList] = useState<engine.AutomationView[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    ListAutomations().then(setList)
  }, [])
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="text-sm text-slate-500">Automations are built in the web interface and run here as files change. They can route, rename, tag, skip and notify, but never modify files on this PC.</p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<RefreshCw className="size-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setList(await RefreshAutomations())
              setBusy(false)
            }}
          >
            Refresh
          </Button>
          <Button variant="primary" icon={<ExternalLink className="size-4" />} onClick={() => OpenWebInterface('/automations')}>
            Open automation builder
          </Button>
        </div>
      </div>
      <div className="card overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={<Workflow className="size-6" />} title="No active automations" description="Enabled automations from your VaultDock account appear here and apply to sync folders set to use them." />
        ) : (
          list.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 last:border-0 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {a.triggers.map((t, i) => (
                    <Badge key={'t' + i} tone="violet">
                      {t}
                    </Badge>
                  ))}
                  <span className="text-xs text-slate-400">→</span>
                  {[...new Set(a.actions)].map((t) => (
                    <Badge key={t} tone="green">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              {a.priority !== 0 && <Badge tone="blue">priority {a.priority}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => OpenWebInterface(`/automations/${a.id}`)}>
                Edit in browser
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
