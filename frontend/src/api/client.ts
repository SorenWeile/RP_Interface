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
): Promise<{ prompt_id: string; client_id: string }> {
  const res = await fetch(`${BASE}/api/workflow/upscale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
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

// ── Batch (Upscale Rework) ────────────────────────────────────────────────

export interface BatchJobStatus {
  prompt_id: string
  client_id: string
  model: string
  run: number
  status: 'queued' | 'processing' | 'done' | 'error'
  images: Array<{ filename: string; subfolder: string; type: string }>
}

export interface BatchStatus {
  batch_id: string
  filename: string
  total: number
  queued: number
  processing: number
  done: number
  error: number
  created_at: string
  jobs: BatchJobStatus[]
}

export async function createUpscaleReworkBatch(params: {
  filename: string
  models: string[]
  runs_per_model: number
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ batch_id: string; total: number }> {
  const res = await fetch(`${BASE}/api/workflow/upscale_rework`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function getBatchStatus(batchId: string): Promise<BatchStatus> {
  const res = await fetch(`${BASE}/api/batch/${batchId}`)
  if (!res.ok) throw new Error(`Batch status failed: ${res.statusText}`)
  return res.json()
}

export async function cancelBatch(batchId: string): Promise<{ cancelled: number }> {
  const res = await fetch(`${BASE}/api/batch/${batchId}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error(`Cancel failed: ${res.statusText}`)
  return res.json()
}

// ── Outfit Swapping ───────────────────────────────────────────────────────

export async function runOutfitSwapping(params: {
  main_image: string
  ref_images: string[]
  prompt: string
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const res = await fetch(`${BASE}/api/workflow/outfit_swapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Panorama Outpainting ──────────────────────────────────────────────────

export async function runPanorama(params: {
  state_json: string
  prompt: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const res = await fetch(`${BASE}/api/workflow/panorama`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
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
