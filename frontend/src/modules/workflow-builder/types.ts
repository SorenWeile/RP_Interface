// Shared types for the workflow builder and custom tool runner.
// Mirrors the Python tools.py data model exactly.

export type FieldType =
  | 'image'
  | 'text'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'select'
  | 'toggle'
  | 'user'   // auto-injected: logged-in username

export interface FieldDef {
  id: string
  label: string
  type: FieldType
  node_id: string
  input_key: string
  required?: boolean
  placeholder?: string
  rows?: number
  min?: number
  max?: number
  step?: number
  default?: unknown
  options?: string[]
  group?: string   // fields sharing a group name render side-by-side
}

export interface PathNodes {
  /** Single INDGOutputPath node id */
  node_id?: string
  /** Multiple INDGOutputPath node ids (e.g. upscale_rework 4K + 8K savers) */
  node_ids?: string[]
}

export interface AutoNode {
  node_id: string
  input_key: string
  strategy: 'random_seed' | 'username'
}

export interface ToolSummary {
  id: string
  name: string
  description: string
  icon: string
  is_builtin: boolean
  created_at: string
}

export interface ToolDef extends ToolSummary {
  fields_json: string        // JSON string — parse to FieldDef[]
  path_nodes: string | null  // JSON string — parse to PathNodes | null
  auto_nodes: string         // JSON string — parse to AutoNode[]
  workflow: string           // raw ComfyUI workflow JSON string (only returned by GET /{id})
}

// Convenience: ToolDef with parsed fields
export interface ParsedToolDef extends ToolSummary {
  fields: FieldDef[]
  pathNodes: PathNodes | null
  autoNodes: AutoNode[]
}

// ── Builder-specific types ────────────────────────────────────────────────────

/** One row in the step-1 inspection table */
export interface DetectedInput {
  node_id: string
  title: string
  class_type: string
  input_key: string
  current_value: unknown
  detected_type: FieldType | 'auto_seed' | 'auto_user' | 'output_path' | 'wired'
}

// ── API payload types ─────────────────────────────────────────────────────────

export interface CreateToolPayload {
  id?: string
  name: string
  description?: string
  icon?: string
  fields_json: string
  path_nodes?: string | null
  auto_nodes?: string
  workflow: string
}

export interface UpdateToolPayload {
  name?: string
  description?: string
  icon?: string
  fields_json?: string
  path_nodes?: string | null
  auto_nodes?: string
}

// ── Runner types ──────────────────────────────────────────────────────────────

export interface ToolRunBody {
  values: Record<string, unknown>
  path_client?: string
  path_product?: string
  path_filename?: string
}

export interface ToolBatchBody extends ToolRunBody {
  count: number
}

export interface ToolBatchRun {
  run_index: number
  prompt_id: string | null
  status: 'queued' | 'processing' | 'done' | 'error'
  images: Array<{ filename: string; subfolder: string; type: string }>
}

export interface ToolBatchStatus {
  batch_id: string
  total: number
  queued: number
  processing: number
  done: number
  error: number
  runs: ToolBatchRun[]
}
