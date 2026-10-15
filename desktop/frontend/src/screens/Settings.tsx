import { useEffect, useState } from 'react'
import { FileText, LogOut, RefreshCw } from 'lucide-react'
import { CheckForUpdates, Disconnect, GetSettings, OpenLogsFolder, OpenURL, SaveSettings } from '../../wailsjs/go/main/App'
import type { config, main } from '../../wailsjs/go/models'
import { Button, Field, PageLoader, Toggle, useUI } from '../ui'
import { errMsg } from '../lib'

export function SettingsScreen({ boot, onChanged }: { boot: main.Bootstrap; onChanged: () => void }) {
  const [s, setS] = useState<config.Settings | null>(null)
  const [update, setUpdate] = useState<main.UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const { toast, confirm } = useUI()
  useEffect(() => {
    GetSettings().then(setS)
  }, [])
  if (!s) return <PageLoader />
  const save = async (patch: Partial<config.Settings>) => {
    const next = { ...s, ...patch } as config.Settings
    setS(next)
    try {
      setS(await SaveSettings(next as any))
    } catch (e) {
      toast('error', 'Could not save settings', errMsg(e))
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">Application</h2>
        <Toggle checked={s.auto_start} onChange={(v) => save({ auto_start: v })} label="Start with Windows" description="Starts minimised to the notification area so synchronisation continues after you sign in." />
        <Toggle checked={s.close_to_tray} onChange={(v) => save({ close_to_tray: v })} label="Keep running in the notification area when the window is closed" description="Takes effect after restarting the app. Use Quit in the tray menu to exit." />
        <Toggle checked={s.notifications} onChange={(v) => save({ notifications: v })} label="Desktop notifications" description="Shown by automations that send notifications to the desktop." />
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">Transfers</h2>
        <Field label="Parallel transfers">
          <select className="input" value={s.concurrency_mode} onChange={(e) => save({ concurrency_mode: e.target.value })}>
            <option value="auto">Automatic: adapt to connection and server performance</option>
            <option value="manual">Fixed number</option>
          </select>
        </Field>
        {s.concurrency_mode === 'auto' ? (
          <Field label="Upper limit for automatic mode" hint="VaultDock measures throughput, latency and errors and only adds connections while they help. The server can lower this limit.">
            <input className="input" type="number" min={1} max={128} value={s.max_parallel} onChange={(e) => save({ max_parallel: Number(e.target.value) })} />
          </Field>
        ) : (
          <Field label="Fixed parallel transfers">
            <input className="input" type="number" min={1} max={128} value={s.manual_parallel} onChange={(e) => save({ manual_parallel: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Upload bandwidth limit (KB/s)" hint="0 means unlimited. Leaves room for gaming and calls on slower connections.">
          <input className="input" type="number" min={0} value={s.bandwidth_kbps} onChange={(e) => save({ bandwidth_kbps: Number(e.target.value) })} />
        </Field>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">Connection</h2>
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">Server</dt>
          <dd className="font-mono text-xs break-all">{boot.settings.server_url}</dd>
          <dt className="text-slate-500">Account</dt>
          <dd>{boot.user}</dd>
          <dt className="text-slate-500">This device</dt>
          <dd>
            {boot.device_name} · {boot.os}
          </dd>
          <dt className="text-slate-500">Device key</dt>
          <dd className="font-mono text-xs">{boot.settings.key_fingerprint} (stored with Windows DPAPI)</dd>
          <dt className="text-slate-500">Certificate</dt>
          <dd className="font-mono text-xs break-all">{boot.settings.pinned_cert ? `pinned ${boot.settings.pinned_cert.slice(0, 32)}…` : 'verified by Windows'}</dd>
        </dl>
        <div className="pt-2">
          <Button
            variant="danger"
            icon={<LogOut className="size-4" />}
            onClick={async () => {
              if (await confirm({ title: 'Disconnect this device?', message: 'The device key is deleted from this PC and synchronisation stops. Your sync folders are kept. Files in VaultDock are not affected. Also revoke the device in the web interface if you no longer trust this PC.', confirmLabel: 'Disconnect' })) {
                await Disconnect()
                onChanged()
              }
            }}
          >
            Disconnect
          </Button>
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">About</h2>
        <p className="text-sm text-slate-500">VaultDock desktop {boot.version}</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<FileText className="size-4" />} onClick={() => OpenLogsFolder()}>
            Open logs folder
          </Button>
          <Button
            icon={<RefreshCw className="size-4" />}
            loading={checking}
            onClick={async () => {
              setChecking(true)
              try {
                setUpdate(await CheckForUpdates())
              } catch (e) {
                toast('error', 'Update check failed', errMsg(e))
              } finally {
                setChecking(false)
              }
            }}
          >
            Check for updates
          </Button>
        </div>
        {update && (
          <p className="text-sm">
            {!update.configured ? (
              'Update checks are not configured in this build. Download new versions from your VaultDock project page.'
            ) : update.available ? (
              <>
                Version {update.latest} is available.{' '}
                <button className="font-medium text-brand-600 hover:underline" onClick={() => OpenURL(update.url)}>
                  Open the release page
                </button>{' '}
                and run the new installer; your settings and sync folders are kept.
              </>
            ) : (
              `You are running the latest version (${update.current}).`
            )}
          </p>
        )}
      </section>
    </div>
  )
}
