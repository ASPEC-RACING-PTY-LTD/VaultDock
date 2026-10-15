import { useCallback, useEffect, useState } from 'react'
import { Activity, FolderSync, Globe, LayoutDashboard, Pause, Play, Settings as SettingsIcon, Workflow } from 'lucide-react'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { GetBootstrap, OpenWebInterface, SetPaused } from '../wailsjs/go/main/App'
import type { engine, main } from '../wailsjs/go/models'
import { Badge, Button, cx, PageLoader, useUI } from './ui'
import { ConnectScreen } from './screens/Connect'
import { Overview } from './screens/Overview'
import { ConfigsScreen } from './screens/Configs'
import { TransfersScreen } from './screens/Transfers'
import { AutomationsScreen } from './screens/Automations'
import { SettingsScreen } from './screens/Settings'
import logo from './logo.png'

type Tab = 'overview' | 'configs' | 'transfers' | 'automations' | 'settings'

const statusTone: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = { idle: 'green', syncing: 'blue', scanning: 'blue', paused: 'amber', offline: 'slate', error: 'red', revoked: 'red' }
const statusLabel: Record<string, string> = { idle: 'Up to date', syncing: 'Syncing', scanning: 'Scanning', paused: 'Paused', offline: 'Offline', error: 'Attention needed', revoked: 'Access revoked' }

export function App() {
  const [boot, setBoot] = useState<main.Bootstrap | null>(null)
  const [snap, setSnap] = useState<engine.Snapshot | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [revoked, setRevoked] = useState(false)
  const { toast } = useUI()

  const reload = useCallback(() => {
    GetBootstrap().then(setBoot)
  }, [])

  useEffect(() => {
    reload()
    const offs = [
      EventsOn('snapshot', (s: engine.Snapshot) => setSnap(s)),
      EventsOn('connected', () => {
        setRevoked(false)
        reload()
      }),
      EventsOn('revoked', () => {
        setRevoked(true)
        reload()
      }),
      EventsOn('settings', reload),
    ]
    return () => offs.forEach((o) => o())
  }, [reload])

  if (!boot) return <PageLoader label="Starting VaultDock" />

  if (!boot.configured || revoked || boot.revoked) {
    return <ConnectScreen boot={boot} revoked={revoked || boot.revoked} onDone={reload} />
  }

  const status = snap?.status ?? 'offline'
  const nav: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'configs', label: 'Sync folders', icon: FolderSync },
    { id: 'transfers', label: 'Transfers', icon: Activity },
    { id: 'automations', label: 'Automations', icon: Workflow },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src={logo} alt="" className="size-8 rounded-lg" />
          <div>
            <div className="text-base leading-tight font-semibold">VaultDock</div>
            <div className="text-[11px] text-slate-500">{boot.user ? `${boot.user} · ` : ''}desktop {boot.version}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition', tab === n.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70')}>
              <n.icon className="size-[18px]" />
              {n.label}
              {n.id === 'transfers' && (snap?.stats.failed ?? 0) > 0 && <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{snap?.stats.failed}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <button onClick={() => OpenWebInterface('/')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <Globe className="size-4" /> Open web interface
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/80 px-6 dark:border-slate-800 dark:bg-slate-950/80">
          <Badge tone={statusTone[status]}>{statusLabel[status] ?? status}</Badge>
          <span className="truncate text-sm text-slate-500">{snap?.message}</span>
          <div className="ml-auto">
            {snap?.paused ? (
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => SetPaused(false).then(() => toast('success', 'Synchronisation resumed'))}>
                Resume
              </Button>
            ) : (
              <Button size="sm" icon={<Pause className="size-3.5" />} onClick={() => SetPaused(true).then(() => toast('info', 'Synchronisation paused', 'In-progress uploads stop and resume later from where they left off.'))}>
                Pause
              </Button>
            )}
          </div>
        </header>
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {tab === 'overview' && <Overview snap={snap} boot={boot} goto={setTab} />}
          {tab === 'configs' && <ConfigsScreen />}
          {tab === 'transfers' && <TransfersScreen snap={snap} />}
          {tab === 'automations' && <AutomationsScreen />}
          {tab === 'settings' && <SettingsScreen boot={boot} onChanged={reload} />}
        </main>
      </div>
    </div>
  )
}
