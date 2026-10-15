// Thin fetch wrapper for the VaultDock API with CSRF handling.

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  body?: any
  constructor(status: number, code: string, message: string, details?: unknown, body?: any) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.body = body
  }
}

let csrfToken = ''
export function setCsrf(token: string) {
  csrfToken = token
}

type Listener = () => void
const unauthListeners = new Set<Listener>()
export function onUnauthenticated(fn: Listener) {
  unauthListeners.add(fn)
  return () => {
    unauthListeners.delete(fn)
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  const res = await fetch('/api/v1' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    ...init,
  })
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const e = data?.error ?? {}
    const err = new ApiError(res.status, e.code ?? 'http_' + res.status, e.message ?? `Request failed (${res.status})`, e.details, data)
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/setup')) {
      unauthListeners.forEach((fn) => fn())
    }
    throw err
  }
  return data as T
}

export const get = <T = any>(p: string) => api<T>('GET', p)
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {})
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {})
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {})
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b)

export function csrfHeader(): Record<string, string> {
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
