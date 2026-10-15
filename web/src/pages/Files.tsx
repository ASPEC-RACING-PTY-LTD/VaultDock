import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowLeft, ArrowRight, Check, ChevronRight, Download, Eye, FolderInput, FolderPlus, FolderUp, Grid2X2, Home, List, MoreHorizontal, Pencil, Search, Tag, Trash2, Upload, X } from 'lucide-react'
import { ApiError, del, errorMessage, get, patch, post, put } from '../lib/api'
import { fileKind, formatBytes, formatDate, previewable, timeAgo } from '../lib/format'
import { filesFromDrop, useUploads } from '../lib/uploads'
import { Badge, Button, ContextMenu, cx, EmptyState, ErrorState, Field, IconButton, Menu, Modal, PageLoader, useUI, type MenuItem } from '../components/ui'
import { FileIcon } from '../components/FileIcon'

export type Node = {
  id: number
  parent_id: number | null
  name: string
  is_dir: boolean
  size: number
  mime: string
  modified_at: number
  created_at: number
  updated_at: number
  tags: string[]
  path?: string
  child_count?: number
  sha256?: string
}

const contentURL = (id: number, download = false) => `/api/v1/files/${id}/content${download ? '?download=1' : ''}`

function downloadIDs(ids: number[], nodes: Node[]) {
  if (ids.length === 1) {
    const n = nodes.find((x) => x.id === ids[0])
    if (n && !n.is_dir) {
      window.location.href = contentURL(n.id, true)
      return
    }
  }
  window.location.href = `/api/v1/files/zip?ids=${ids.join(',')}`
}

export function FilesPage() {
  const { folderId } = useParams()
  const [params, setParams] = useSearchParams()
  const searchQ = params.get('search') ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast, confirm } = useUI()
  const uploads = useUploads()

  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('vd-files-view') as any) || 'list')
  const [sort, setSort] = useState<{ by: string; desc: boolean }>({ by: 'name', desc: false })
  const [kind, setKind] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; node: Node } | null>(null)
  const [preview, setPreview] = useState<Node | null>(null)
  const [renaming, setRenaming] = useState<Node | null>(null)
  const [moving, setMoving] = useState<number[] | null>(null)
  const [tagging, setTagging] = useState<Node | null>(null)
  const [newFolder, setNewFolder] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  useEffect(() => localStorage.setItem('vd-files-view', view), [view])
  useEffect(() => {
    setSelected(new Set())
    setFilter('')
  }, [folderId, searchQ])

  const parent = folderId ?? 'root'
  const listQ = useQuery({
    queryKey: ['files', parent, sort.by, sort.desc, kind, searchQ],
    queryFn: () =>
      searchQ
        ? get(`/files/search?q=${encodeURIComponent(searchQ)}&sort=${sort.by}&order=${sort.desc ? 'desc' : 'asc'}${kind ? `&kind=${kind}` : ''}&limit=500`).then((r) => ({ items: r.items, breadcrumbs: [], folder: null, total: r.items.length }))
        : get(`/files?parent=${parent}&sort=${sort.by}&order=${sort.desc ? 'desc' : 'asc'}${kind ? `&kind=${kind}` : ''}`),
  })
  const items: Node[] = useMemo(() => {
    const all: Node[] = listQ.data?.items ?? []
    if (!filter.trim()) return all
    const f = filter.toLowerCase()
    return all.filter((n) => n.name.toLowerCase().includes(f))
  }, [listQ.data, filter])
  const crumbs: { id: number; name: string }[] = listQ.data?.breadcrumbs ?? []
  const folder: Node | null = listQ.data?.folder ?? null
  const folderPath = '/' + crumbs.slice(1).map((c) => c.name).join('/')

  // highlight ?select=
  useEffect(() => {
    const s = Number(params.get('select'))
    if (s && items.some((i) => i.id === s)) {
      setSelected(new Set([s]))
      const n = items.find((i) => i.id === s)
      if (n && !n.is_dir && previewable(n.mime)) setPreview(n)
      params.delete('select')
      setParams(params, { replace: true })
    }
  }, [items, params, setParams])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }

  const open = (n: Node) => {
    if (n.is_dir) navigate(`/files/${n.id}`)
    else setPreview(n)
  }

  const onRowClick = (e: RMouseEvent, n: Node, idx: number) => {
    if (e.shiftKey && anchor !== null) {
      const a = items.findIndex((i) => i.id === anchor)
      const [s, t] = a < idx ? [a, idx] : [idx, a]
      setSelected(new Set(items.slice(s, t + 1).map((i) => i.id)))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      next.has(n.id) ? next.delete(n.id) : next.add(n.id)
      setSelected(next)
      setAnchor(n.id)
    } else {
      setSelected(new Set([n.id]))
      setAnchor(n.id)
    }
  }

  const toggleOne = (id: number) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
    setAnchor(id)
  }

  const deleteIDs = useCallback(
    async (ids: number[]) => {
      const names = items.filter((i) => ids.includes(i.id)).map((i) => i.name)
      const ok = await confirm({
        title: ids.length === 1 ? `Move "${names[0]}" to trash?` : `Move ${ids.length} items to trash?`,
        message: 'Items in the trash can be restored until they are permanently deleted or the retention period ends.',
        confirmLabel: 'Move to trash',
      })
      if (!ok) return
      try {
        const res = await post('/files/delete', { ids })
        toast('success', `Moved ${res.deleted} item(s) to trash`, res.failed?.length ? `${res.failed.length} could not be deleted` : undefined)
        setSelected(new Set())
        refresh()
      } catch (e) {
        toast('error', 'Delete failed', errorMessage(e))
      }
    },
    [items, confirm, toast],
  )

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,[role=dialog]')) return
      if (e.key === 'Delete' && selected.size) deleteIDs([...selected])
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelected(new Set(items.map((i) => i.id)))
      }
      if (e.key === 'Escape') setSelected(new Set())
      if (e.key === 'F2' && selected.size === 1) setRenaming(items.find((i) => selected.has(i.id)) ?? null)
      if (e.key === 'Enter' && selected.size === 1) {
        const n = items.find((i) => selected.has(i.id))
        if (n) open(n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const enqueueFiles = (files: { file: File; rel: string }[]) => {
    if (searchQ) {
      toast('warning', 'Open a folder to upload into it')
      return
    }
    const base = folderPath === '/' ? '' : folderPath
    uploads.enqueue(files.map((f) => ({ file: f.file, path: `${base}/${f.rel}` })))
    toast('info', `Uploading ${files.length} file(s)`, 'Track progress on the Uploads page.')
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.types.includes('application/x-vaultdock-nodes')) return
    const files = await filesFromDrop(e.dataTransfer)
    if (files.length) enqueueFiles(files)
  }

  const moveTo = async (ids: number[], target: number) => {
    try {
      const res = await post('/files/move', { ids, parent_id: target })
      if (res.failed?.length) toast('warning', `Moved ${res.moved} item(s)`, res.failed.map((f: any) => f.error).join('; '))
      else toast('success', `Moved ${res.moved} item(s)`)
      setSelected(new Set())
      refresh()
    } catch (e) {
      toast('error', 'Move failed', errorMessage(e))
    }
  }

  const menuFor = (n: Node): MenuItem[] => {
    const ids = selected.has(n.id) && selected.size > 1 ? [...selected] : [n.id]
    if (ids.length > 1) {
      return [
        { label: `Download ${ids.length} items (zip)`, icon: <Download className="size-4" />, onClick: () => downloadIDs(ids, items) },
        { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => setMoving(ids) },
        'divider',
        { label: 'Move to trash', icon: <Trash2 className="size-4" />, danger: true, onClick: () => deleteIDs(ids) },
      ]
    }
    return [
      { label: n.is_dir ? 'Open' : 'Preview', icon: <Eye className="size-4" />, onClick: () => open(n), disabled: !n.is_dir && !previewable(n.mime) },
      { label: n.is_dir ? 'Download as zip' : 'Download', icon: <Download className="size-4" />, onClick: () => downloadIDs([n.id], items) },
      ...(searchQ && n.parent_id ? [{ label: 'Show in folder', icon: <FolderInput className="size-4" />, onClick: () => navigate(`/files/${n.parent_id}?select=${n.id}`) }] : []),
      'divider',
      { label: 'Rename', icon: <Pencil className="size-4" />, onClick: () => setRenaming(n) },
      { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => setMoving([n.id]) },
      ...(!n.is_dir ? [{ label: 'Edit tags', icon: <Tag className="size-4" />, onClick: () => setTagging(n) }] : []),
      'divider',
      { label: 'Move to trash', icon: <Trash2 className="size-4" />, danger: true, onClick: () => deleteIDs([n.id]) },
    ]
  }

  const sortLabel: Record<string, string> = { name: 'Name', size: 'Size', modified: 'Modified', type: 'Type' }
  const previewList = items.filter((i) => !i.is_dir && previewable(i.mime))

  return (
    <div
      className="relative min-h-[70vh]"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {/* header */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {searchQ ? (
            <div className="flex items-center gap-3">
              <IconButton label="Back" onClick={() => navigate('/files')}>
                <ArrowLeft className="size-5" />
              </IconButton>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Search results</h1>
                <p className="text-sm text-slate-500">
                  for “{searchQ}” · {items.length} match{items.length === 1 ? '' : 'es'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
                {crumbs.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3.5 text-slate-400" />}
                    <Link
                      to={i === 0 ? '/files' : `/files/${c.id}`}
                      className={cx('flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800', i === crumbs.length - 1 && 'font-medium text-slate-800 dark:text-slate-100')}
                      onDragOver={(e) => e.dataTransfer.types.includes('application/x-vaultdock-nodes') && e.preventDefault()}
                      onDrop={(e) => {
                        const raw = e.dataTransfer.getData('application/x-vaultdock-nodes')
                        if (raw) moveTo(JSON.parse(raw), c.id)
                      }}
                    >
                      {i === 0 ? <Home className="size-3.5" /> : null}
                      {i === 0 ? 'My files' : c.name}
                    </Link>
                  </span>
                ))}
              </nav>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{crumbs.length > 1 ? crumbs[crumbs.length - 1].name : 'My files'}</h1>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!searchQ && (
            <>
              <Button icon={<FolderPlus className="size-4" />} onClick={() => setNewFolder(true)}>
                New folder
              </Button>
              <Button icon={<FolderUp className="size-4" />} onClick={() => folderInput.current?.click()}>
                Upload folder
              </Button>
              <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
                Upload files
              </Button>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              enqueueFiles(Array.from(e.target.files ?? []).map((f) => ({ file: f, rel: f.name })))
              e.target.value = ''
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={(e) => {
              enqueueFiles(Array.from(e.target.files ?? []).map((f) => ({ file: f, rel: (f as any).webkitRelativePath || f.name })))
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {/* toolbar */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-2">
        {selected.size > 0 ? (
          <div className="flex flex-1 flex-wrap items-center gap-2 px-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{selected.size} selected</span>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadIDs([...selected], items)}>
              Download
            </Button>
            <Button size="sm" icon={<FolderInput className="size-3.5" />} onClick={() => setMoving([...selected])}>
              Move
            </Button>
            {selected.size === 1 && (
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setRenaming(items.find((i) => selected.has(i.id)) ?? null)}>
                Rename
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-rose-600" icon={<Trash2 className="size-3.5" />} onClick={() => deleteIDs([...selected])}>
              Delete
            </Button>
            <IconButton label="Clear selection" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </IconButton>
          </div>
        ) : (
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input h-8 border-transparent bg-slate-100 pl-8 shadow-none dark:bg-slate-800" placeholder={searchQ ? 'Filter results' : 'Filter this folder'} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        )}
        <select className="input h-8 w-auto py-0" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="File type">
          <option value="">All types</option>
          <option value="folder">Folders</option>
          <option value="video">Videos</option>
          <option value="image">Images</option>
          <option value="audio">Audio</option>
          <option value="document">Documents</option>
          <option value="archive">Archives</option>
          <option value="other">Other</option>
        </select>
        <Menu
          trigger={(o) => (
            <Button size="sm" variant="ghost" icon={<ArrowDownAZ className="size-4" />} onClick={o}>
              {sortLabel[sort.by]} {sort.desc ? '↓' : '↑'}
            </Button>
          )}
          items={[
            ...['name', 'modified', 'size', 'type'].map((b) => ({ label: sortLabel[b], icon: sort.by === b ? <Check className="size-4" /> : undefined, onClick: () => setSort({ by: b, desc: sort.by === b ? !sort.desc : b !== 'name' }) })),
          ]}
        />
        <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button className={cx('rounded-md p-1.5', view === 'list' ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500')} onClick={() => setView('list')} aria-label="List view">
            <List className="size-4" />
          </button>
          <button className={cx('rounded-md p-1.5', view === 'grid' ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500')} onClick={() => setView('grid')} aria-label="Grid view">
            <Grid2X2 className="size-4" />
          </button>
        </div>
      </div>

      {/* content */}
      {listQ.isLoading ? (
        <PageLoader />
      ) : listQ.error ? (
        <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
      ) : items.length === 0 ? (
        <div className="card">
          {searchQ || filter || kind ? (
            <EmptyState icon={<Search className="size-6" />} title="No matching files" description="Try a different search term or file type." />
          ) : (
            <EmptyState
              icon={<Upload className="size-6" />}
              title="This folder is empty"
              description="Drag files or folders here, or use the upload buttons. Files from the desktop app appear here automatically."
              action={
                <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
                  Upload files
                </Button>
              }
            />
          )}
        </div>
      ) : view === 'list' ? (
        <div className="card overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" className="size-4 rounded accent-brand-600" checked={selected.size === items.length && items.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} aria-label="Select all" />
                </th>
                <th className="px-2 py-2.5">Name</th>
                <th className="hidden w-40 px-3 py-2.5 md:table-cell">Modified</th>
                <th className="hidden w-28 px-3 py-2.5 text-right sm:table-cell">Size</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {items.map((n, idx) => (
                <tr
                  key={n.id}
                  draggable
                  onDragStart={(e) => {
                    const ids = selected.has(n.id) ? [...selected] : [n.id]
                    e.dataTransfer.setData('application/x-vaultdock-nodes', JSON.stringify(ids))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => n.is_dir && e.dataTransfer.types.includes('application/x-vaultdock-nodes') && e.preventDefault()}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData('application/x-vaultdock-nodes')
                    if (raw && n.is_dir) {
                      e.stopPropagation()
                      const ids: number[] = JSON.parse(raw).filter((x: number) => x !== n.id)
                      if (ids.length) moveTo(ids, n.id)
                    }
                  }}
                  onClick={(e) => onRowClick(e, n, idx)}
                  onDoubleClick={() => open(n)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!selected.has(n.id)) setSelected(new Set([n.id]))
                    setCtx({ x: e.clientX, y: e.clientY, node: n })
                  }}
                  className={cx('group cursor-default border-b border-slate-100 last:border-0 dark:border-slate-800/70', selected.has(n.id) ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="size-4 rounded accent-brand-600" checked={selected.has(n.id)} onChange={() => toggleOne(n.id)} aria-label={`Select ${n.name}`} />
                  </td>
                  <td className="max-w-0 px-2 py-2">
                    <div className="flex items-center gap-3">
                      <FileIcon mime={n.mime} isDir={n.is_dir} size="sm" />
                      <div className="min-w-0">
                        <button className="block max-w-full truncate text-left font-medium text-slate-800 hover:text-brand-600 hover:underline dark:text-slate-100" onClick={(e) => (e.stopPropagation(), open(n))}>
                          {n.name}
                        </button>
                        <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                          {searchQ && n.path ? <span className="truncate">{n.path}</span> : n.is_dir ? <span>{n.child_count ?? 0} items</span> : <span className="sm:hidden">{formatBytes(n.size)}</span>}
                          {n.tags.slice(0, 3).map((t) => (
                            <Badge key={t} tone="violet" className="px-1.5 py-0 text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 whitespace-nowrap text-slate-500 md:table-cell" title={formatDate(n.modified_at)}>
                    {timeAgo(n.modified_at)}
                  </td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap text-slate-500 tabular-nums sm:table-cell">{n.is_dir ? '-' : formatBytes(n.size)}</td>
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      label="Actions"
                      className="opacity-60 group-hover:opacity-100"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setCtx({ x: r.right, y: r.bottom + 4, node: n })
                      }}
                    >
                      <MoreHorizontal className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {listQ.data?.total > items.length && !filter && <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">Showing {items.length} of {listQ.data.total} items.</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {items.map((n, idx) => (
            <div
              key={n.id}
              onClick={(e) => onRowClick(e, n, idx)}
              onDoubleClick={() => open(n)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (!selected.has(n.id)) setSelected(new Set([n.id]))
                setCtx({ x: e.clientX, y: e.clientY, node: n })
              }}
              className={cx('card group relative flex cursor-default flex-col overflow-hidden transition', selected.has(n.id) ? 'ring-2 ring-brand-500' : 'hover:shadow-md')}
            >
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800/60">
                {fileKind(n.mime, n.is_dir) === 'image' && n.mime !== 'image/svg+xml' && n.size < 25 * 1024 * 1024 ? <img src={contentURL(n.id)} alt="" loading="lazy" className="size-full object-cover" /> : fileKind(n.mime, n.is_dir) === 'video' && items.length <= 60 ? <video src={contentURL(n.id) + '#t=1'} preload="metadata" muted className="size-full object-cover" /> : <FileIcon mime={n.mime} isDir={n.is_dir} size="lg" />}
              </div>
              <div className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{n.name}</div>
                  <div className="text-xs text-slate-500">{n.is_dir ? `${n.child_count ?? 0} items` : formatBytes(n.size)}</div>
                </div>
                <IconButton
                  label="Actions"
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setCtx({ x: r.right, y: r.bottom + 4, node: n })
                  }}
                >
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </div>
              <input type="checkbox" className={cx('absolute top-2 left-2 size-4 accent-brand-600', selected.has(n.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} checked={selected.has(n.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleOne(n.id)} aria-label={`Select ${n.name}`} />
            </div>
          ))}
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-brand-50/80 backdrop-blur-sm dark:bg-brand-500/10">
          <div className="text-center">
            <Upload className="mx-auto mb-2 size-10 text-brand-600" />
            <div className="text-lg font-semibold text-brand-700 dark:text-brand-300">Drop to upload</div>
            <div className="text-sm text-brand-600/80">into {folderPath === '/' ? 'My files' : folderPath}</div>
          </div>
        </div>
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menuFor(ctx.node)} onClose={() => setCtx(null)} />}
      {preview && <PreviewModal node={preview} list={previewList} onNavigate={setPreview} onClose={() => setPreview(null)} />}
      <NewFolderModal open={newFolder} parentId={folder?.id ?? 0} onClose={() => setNewFolder(false)} onDone={refresh} />
      <RenameModal node={renaming} onClose={() => setRenaming(null)} onDone={refresh} />
      <TagsModal node={tagging} onClose={() => setTagging(null)} onDone={refresh} />
      <MoveModal ids={moving} onClose={() => setMoving(null)} onMove={(target) => moving && moveTo(moving, target)} />
    </div>
  )
}

function NewFolderModal({ open, parentId, onClose, onDone }: { open: boolean; parentId: number; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setError('')
    }
  }, [open])
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    try {
      await post('/files/folder', { parent_id: parentId, name })
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New folder"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => submit()}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Folder name" error={error}>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

function RenameModal({ node, onClose, onDone }: { node: Node | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (node) {
      setName(node.name)
      setError('')
      setTimeout(() => {
        const dot = node.is_dir ? -1 : node.name.lastIndexOf('.')
        inputRef.current?.setSelectionRange(0, dot > 0 ? dot : node.name.length)
      }, 30)
    }
  }, [node])
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!node) return
    setBusy(true)
    try {
      await patch(`/files/${node.id}`, { name })
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={!!node}
      onClose={onClose}
      title="Rename"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || name === node?.name} onClick={() => submit()}>
            Rename
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Name" error={error}>
          <input ref={inputRef} className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

function TagsModal({ node, onClose, onDone }: { node: Node | null; onClose: () => void; onDone: () => void }) {
  const [tags, setTags] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useUI()
  const { data } = useQuery({ queryKey: ['tags'], queryFn: () => get('/files/tags'), enabled: !!node })
  useEffect(() => {
    if (node) {
      setTags(node.tags)
      setInput('')
    }
  }, [node])
  const add = (t: string) => {
    t = t.trim()
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t])
    setInput('')
  }
  const save = async () => {
    if (!node) return
    setBusy(true)
    try {
      await put(`/files/${node.id}/tags`, { tags: input.trim() ? [...tags, input.trim()] : tags })
      onDone()
      onClose()
    } catch (e) {
      toast('error', 'Could not save tags', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const suggestions = (data?.tags ?? []).map((t: any) => t.tag).filter((t: string) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())).slice(0, 8)
  return (
    <Modal
      open={!!node}
      onClose={onClose}
      title={`Tags for ${node?.name ?? ''}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save tags
          </Button>
        </>
      }
    >
      <div className="mb-3 flex min-h-8 flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-sm text-slate-500">No tags yet.</span>}
        {tags.map((t) => (
          <Badge key={t} tone="violet">
            {t}
            <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <input
        className="input"
        placeholder="Add a tag and press Enter"
        value={input}
        autoFocus
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(input)
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s: string) => (
            <button key={s} onClick={() => add(s)} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300">
              + {s}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function MoveModal({ ids, onClose, onMove, title = 'Move to folder' }: { ids: number[] | null; onClose: () => void; onMove: (target: number) => void; title?: string }) {
  const [cur, setCur] = useState<string>('root')
  useEffect(() => {
    if (ids) setCur('root')
  }, [ids])
  const { data, isLoading } = useQuery({ queryKey: ['folder-picker', cur], queryFn: () => get(`/files?parent=${cur}&kind=folder&sort=name`), enabled: !!ids })
  const crumbs: { id: number; name: string }[] = data?.breadcrumbs ?? []
  const target = data?.folder?.id
  return (
    <Modal
      open={!!ids}
      onClose={onClose}
      title={title}
      description={ids ? `${ids.length} item(s) selected` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!target}
            onClick={() => {
              onMove(target)
              onClose()
            }}
          >
            Move here
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-slate-400" />}
            <button className="rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setCur(i === 0 ? 'root' : String(c.id))}>
              {i === 0 ? 'My files' : c.name}
            </button>
          </span>
        ))}
      </div>
      <div className="scroll-thin max-h-80 min-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
        {isLoading && <PageLoader />}
        {!isLoading && (data?.items ?? []).length === 0 && <div className="p-6 text-center text-sm text-slate-500">No subfolders here.</div>}
        {(data?.items ?? []).map((f: Node) => (
          <button key={f.id} disabled={ids?.includes(f.id)} onClick={() => setCur(String(f.id))} className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:hover:bg-slate-800/50">
            <FileIcon mime="" isDir size="sm" />
            <span className="flex-1 truncate">{f.name}</span>
            <ChevronRight className="size-4 text-slate-400" />
          </button>
        ))}
      </div>
    </Modal>
  )
}

function TextPreview({ id }: { id: number }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(contentURL(id), { headers: { Range: 'bytes=0-524287' }, signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok && r.status !== 206) throw new ApiError(r.status, 'http', `Preview failed (${r.status})`)
        setText(await r.text())
      })
      .catch((e) => e.name !== 'AbortError' && setErr(errorMessage(e)))
    return () => ctrl.abort()
  }, [id])
  if (err) return <ErrorState error={err} />
  if (text === null) return <PageLoader />
  return <pre className="scroll-thin max-h-[70vh] overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-100">{text}</pre>
}

function PreviewModal({ node, list, onNavigate, onClose }: { node: Node; list: Node[]; onNavigate: (n: Node) => void; onClose: () => void }) {
  const k = fileKind(node.mime, false)
  const idx = list.findIndex((n) => n.id === node.id)
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'VIDEO') return
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev)
      if (e.key === 'ArrowRight' && next) onNavigate(next)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [prev, next, onNavigate])
  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={node.name}
      description={`${formatBytes(node.size)} · modified ${formatDate(node.modified_at)}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((t) => (
              <Badge key={t} tone="violet">
                {t}
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Button icon={<ArrowLeft className="size-4" />} disabled={!prev} onClick={() => prev && onNavigate(prev)}>
              Previous
            </Button>
            <Button icon={<ArrowRight className="size-4" />} disabled={!next} onClick={() => next && onNavigate(next)}>
              Next
            </Button>
            <a href={contentURL(node.id, true)}>
              <Button variant="primary" icon={<Download className="size-4" />}>
                Download
              </Button>
            </a>
          </div>
        </div>
      }
    >
      <div className="flex min-h-[50vh] items-center justify-center">
        {k === 'image' && node.mime !== 'image/svg+xml' && <img src={contentURL(node.id)} alt={node.name} className="max-h-[72vh] max-w-full rounded-lg object-contain" />}
        {k === 'video' && (
          // The browser streams via HTTP range requests; nothing is buffered in full.
          <video key={node.id} src={contentURL(node.id)} controls autoPlay preload="metadata" className="max-h-[72vh] w-full rounded-lg bg-black">
            Your browser cannot play this video format. Download it instead.
          </video>
        )}
        {k === 'audio' && <audio key={node.id} src={contentURL(node.id)} controls autoPlay className="w-full max-w-xl" />}
        {k === 'pdf' && <iframe title={node.name} src={contentURL(node.id)} className="h-[72vh] w-full rounded-lg border border-slate-200 dark:border-slate-800" />}
        {k === 'text' && (
          <div className="w-full">
            <TextPreview id={node.id} />
          </div>
        )}
        {!previewable(node.mime) && <EmptyState icon={<Eye className="size-6" />} title="No preview available" description="Download the file to open it." />}
      </div>
      {k === 'video' && <p className="mt-3 text-center text-xs text-slate-500">MP4 (H.264/AAC) and WebM play in all modern browsers. MKV playback depends on the browser and codecs used.</p>}
    </Modal>
  )
}

export { del }
