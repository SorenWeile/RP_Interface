import type {
  ToolSummary,
  ToolDef,
  CreateToolPayload,
  UpdateToolPayload,
  ToolRunBody,
  ToolBatchBody,
  ToolBatchStatus,
} from '@/modules/workflow-builder/types'

// In Electron the preload exposes the backend URL synchronously before any
// script runs. In the Vite dev server VITE_API_URL is used instead (proxied
// to localhost:8000 via vite.config.ts).
const BASE: string =
  (window as Window & { electronAPI?: { backendUrl?: string } }).electronAPI?.backendUrl
  ?? import.meta.env.VITE_API_URL
  ?? ''

// ── Upload ────────────────────────────────────────────────────────────────

export async function uploadImage(file: File): Promise<{ filename: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
  return res.json()
}

// ── Magnific Upscaler ─────────────────────────────────────────────────────

export async function runMagnificUpscaler(params: {
  filename: string
  sharpen: number
  smart_grain: number
  ultra_detail: number
  scale_factor: string
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/magnific_upscaler`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Status ────────────────────────────────────────────────────────────────

export interface StatusResult {
  status: 'pending' | 'processing' | 'done' | 'error'
  images?: Array<{ filename: string; subfolder: string; type: string }>
  videos?: Array<{ filename: string; subfolder: string; type: string; format?: string }>
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
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/upscale_rework`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
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
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/outfit_swapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
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
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/panorama`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Image Edit ────────────────────────────────────────────────────────────

export async function runImageEdit(params: {
  filename: string
  prompt: string
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/image_edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Image Edit Batch ──────────────────────────────────────────────────────────

export async function createImageEditBatch(params: {
  filename: string
  prompt: string
  ref_images: string[]
  count: number
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ batch_id: string; total: number }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/image_edit/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Video Creation ────────────────────────────────────────────────────────────

export async function runVideoCreation(params: {
  first_frame: string
  last_frame: string
  prompt: string
  length: number
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ prompt_id: string; client_id: string }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/video_creation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export function videoUrl(filename: string, subfolder = '', type = 'output'): string {
  return `${BASE}/api/video?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`
}

// ── Image Prompting ───────────────────────────────────────────────────────────

export async function createImagePromptingBatch(params: {
  ref_images: string[]
  prompt: string
  count: number
  client_path: string
  product_path: string
  filename_prefix: string
}): Promise<{ batch_id: string; total: number }> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}/api/workflow/image_prompting/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

// ── Deadline render farm ──────────────────────────────────────────────────

export async function submitImagePromptingToFarm(params: {
  refFiles: (File | null)[]
  prompt: string
  count: number
  clientPath: string
  productPath: string
  filePrefix: string
}): Promise<{ job_id: string; deadline_job_id: string }> {
  const form = new FormData()
  form.append('workflow_type', 'image_prompting')
  form.append('params', JSON.stringify({
    prompt: params.prompt,
    count: params.count,
    client_path: params.clientPath,
    product_path: params.productPath,
    filename_prefix: params.filePrefix,
  }))
  form.append('path_client', params.clientPath)
  form.append('path_product', params.productPath)
  form.append('path_filename', params.filePrefix)
  params.refFiles.forEach((file, i) => {
    if (file) form.append('images', file, `ref_${i}__${file.name}`)
  })
  const res = await fetch(`${BASE}/api/deadline/submit`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function getDeadlineStatus(deadlineJobId: string): Promise<{
  deadline_job_id: string
  status: string
  progress: number
}> {
  const res = await fetch(`${BASE}/api/deadline/status/${deadlineJobId}`)
  if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`)
  return res.json()
}

// ── Tools (built-in + custom) ─────────────────────────────────────────────

async function _toolFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('user_token') ?? ''
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Token': token,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res
}

export async function listTools(): Promise<ToolSummary[]> {
  const res = await _toolFetch('/api/tools/')
  return res.json()
}

export async function getTool(id: string): Promise<ToolDef> {
  const res = await _toolFetch(`/api/tools/${id}`)
  return res.json()
}

export async function createTool(payload: CreateToolPayload): Promise<ToolDef> {
  const res = await _toolFetch('/api/tools/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function updateTool(id: string, patch: UpdateToolPayload): Promise<ToolDef> {
  const res = await _toolFetch(`/api/tools/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return res.json()
}

export async function deleteTool(id: string): Promise<void> {
  await _toolFetch(`/api/tools/${id}`, { method: 'DELETE' })
}

export async function runTool(
  id: string,
  body: ToolRunBody,
): Promise<{ prompt_id: string; client_id: string }> {
  const res = await _toolFetch(`/api/tools/${id}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function runToolBatch(
  id: string,
  body: ToolBatchBody,
): Promise<{ batch_id: string; total: number }> {
  const res = await _toolFetch(`/api/tools/${id}/batch`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function getToolBatchStatus(batchId: string): Promise<ToolBatchStatus> {
  const res = await _toolFetch(`/api/tools/batch/${batchId}`)
  return res.json()
}

export async function cancelToolBatch(batchId: string): Promise<{ cancelled: number }> {
  const res = await _toolFetch(`/api/tools/batch/${batchId}/cancel`, { method: 'POST' })
  return res.json()
}

export function toolBatchDownloadUrl(batchId: string): string {
  return `${BASE}/api/tools/batch/${batchId}/download`
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
  // When loaded from file:// (Electron), window.location.host is empty.
  // Use the stored backend URL instead.
  const backendOrigin =
    (window as Window & { electronAPI?: { backendUrl?: string } }).electronAPI?.backendUrl
    ?? window.location.origin
  const url    = new URL(backendOrigin)
  const proto  = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws     = new WebSocket(`${proto}//${url.host}/ws/${client_id}`)

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
