const BASE = import.meta.env.VITE_API_URL ?? ''

// ── Upload ────────────────────────────────────────────────────────────────

export async function uploadImage(file: File): Promise<{ filename: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
  return res.json()
}

// ── Workflow ──────────────────────────────────────────────────────────────

export async function runUpscale(
  filename: string,
  scale_by = 2.0,
): Promise<{ prompt_id: string; client_id: string }> {
  const res = await fetch(`${BASE}/api/workflow/upscale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, scale_by }),
  })
  if (!res.ok) throw new Error(`Workflow failed: ${res.statusText}`)
  return res.json()
}

// ── Status ────────────────────────────────────────────────────────────────

export interface StatusResult {
  status: 'pending' | 'processing' | 'done' | 'error'
  images?: Array<{ filename: string; subfolder: string; type: string }>
}

export async function getStatus(prompt_id: string): Promise<StatusResult> {
  const res = await fetch(`${BASE}/api/status/${prompt_id}`)
  if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`)
  return res.json()
}

// ── Image URL ─────────────────────────────────────────────────────────────

export function imageUrl(filename: string, subfolder = '', type = 'output'): string {
  return `${BASE}/api/image?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`
}

// ── WebSocket ─────────────────────────────────────────────────────────────

export type ProgressEvent =
  | { type: 'progress'; value: number; max: number }
  | { type: 'complete'; prompt_id: string }
  | { type: 'error'; message?: string; data?: unknown }

export function connectProgress(
  client_id: string,
  prompt_id: string,
  onEvent: (e: ProgressEvent) => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host  = window.location.host
  const ws    = new WebSocket(`${proto}://${host}/ws/${client_id}`)

  ws.onopen = () => ws.send(JSON.stringify({ prompt_id }))
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as ProgressEvent)
    } catch {
      // ignore malformed frames
    }
  }

  return () => ws.close()
}
