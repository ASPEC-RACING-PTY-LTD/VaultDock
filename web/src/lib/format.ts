export function formatBytes(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || isNaN(n)) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  if (!bps || bps < 1) return '-'
  return formatBytes(bps) + '/s'
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '-'
  if (sec < 60) return `${Math.ceil(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  const h = Math.floor(sec / 3600)
  return `${h}h ${Math.round((sec % 3600) / 60)}m`
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return 'never'
  const diff = (ms - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return diff < 0 ? 'just now' : 'in a few seconds'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(ms).toLocaleDateString()
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'document' | 'other'

export function fileKind(mime: string, isDir: boolean): FileKind {
  if (isDir) return 'folder'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  if (/zip|7z|rar|tar|gzip|bzip|x-xz/.test(mime)) return 'archive'
  if (/word|excel|sheet|presentation|powerpoint|opendocument|rtf/.test(mime)) return 'document'
  return 'other'
}

export function previewable(mime: string): boolean {
  const k = fileKind(mime, false)
  return k === 'image' || k === 'video' || k === 'audio' || k === 'pdf' || k === 'text'
}

export function pluralize(n: number, word: string, plural = word + 's') {
  return `${n.toLocaleString()} ${n === 1 ? word : plural}`
}
