import type { FieldDef, DetectedInput, FieldType } from './types'

// ── Group helpers ─────────────────────────────────────────────────────────────

/** Groups consecutive FieldDefs sharing the same non-empty .group value into rows. */
export function groupFields(fields: FieldDef[]): FieldDef[][] {
  const rows: FieldDef[][] = []
  for (const f of fields) {
    const last = rows[rows.length - 1]
    if (f.group && last && last[0].group === f.group) {
      last.push(f)
    } else {
      rows.push([f])
    }
  }
  return rows
}

// ── Public API ────────────────────────────────────────────────────────────────

export function detectInputs(workflow: Record<string, unknown>): DetectedInput[] {
  const out: DetectedInput[] = []

  for (const [nodeId, nodeRaw] of Object.entries(workflow)) {
    const node = nodeRaw as Record<string, unknown>
    if (!node || typeof node !== 'object') continue

    const classType = (node.class_type as string) ?? ''
    const meta      = node._meta as Record<string, unknown> | undefined
    const title     = (meta?.title as string) || classType
    const inputs    = (node.inputs as Record<string, unknown>) ?? {}

    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value)) continue
      if (value !== null && typeof value === 'object') continue

      out.push({
        node_id:        nodeId,
        title,
        class_type:     classType,
        input_key:      key,
        current_value:  value,
        detected_type:  classify(classType, title, key, value),
      })
    }
  }

  out.sort((a, b) => (parseInt(a.node_id, 10) || 0) - (parseInt(b.node_id, 10) || 0))
  return out
}

/** Build a FieldDef from a detected input (initial defaults). */
export function buildFieldDef(d: DetectedInput): FieldDef {
  const label = guessLabel(d.title)
  const type: FieldType =
    d.detected_type === 'auto_seed' ||
    d.detected_type === 'output_path' ||
    d.detected_type === 'wired'
      ? 'text'
      : (d.detected_type as FieldType)

  const base: FieldDef = {
    id:         slugify(label),
    label,
    type,
    node_id:    d.node_id,
    input_key:  d.input_key,
    required:   false,
    default:    d.current_value,
  }

  if (type === 'number' || type === 'slider') {
    base.min  = 0
    base.max  = typeof d.current_value === 'number' && d.current_value > 100
      ? d.current_value * 2
      : 100
    base.step = typeof d.current_value === 'number' && Number.isInteger(d.current_value) ? 1 : 0.1
  }
  if (type === 'textarea') {
    base.rows        = 4
    base.placeholder = ''
  }

  return base
}

/** Return unique INDGOutputPath node IDs + titles detected in the workflow. */
export function detectOutputPathNodes(
  workflow: Record<string, unknown>,
): Array<{ node_id: string; title: string }> {
  const out: Array<{ node_id: string; title: string }> = []
  for (const [nodeId, nodeRaw] of Object.entries(workflow)) {
    const node = nodeRaw as Record<string, unknown>
    if (!node || typeof node !== 'object') continue
    if ((node.class_type as string) !== 'INDGOutputPath') continue
    const meta  = node._meta as Record<string, unknown> | undefined
    const title = (meta?.title as string) || nodeId
    out.push({ node_id: nodeId, title })
  }
  out.sort((a, b) => (parseInt(a.node_id, 10) || 0) - (parseInt(b.node_id, 10) || 0))
  return out
}

export function guessLabel(title: string): string {
  let t = (title || '').replace(/^\d+_/, '').replace(/_/g, ' ')
  t = t.replace(/\s+-\s+.*$/, '')
  t = t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  return t.trim() || title || 'Field'
}

export function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
}

// ── Classification ────────────────────────────────────────────────────────────

function classify(
  classType: string,
  title: string,
  key: string,
  value: unknown,
): DetectedInput['detected_type'] {
  // Auto: seed
  if (key === 'seed' || /\bseed\b/i.test(key) || /seed/i.test(classType)) {
    if (typeof value === 'number') return 'auto_seed'
  }

  // Output path nodes
  if (
    classType === 'INDGOutputPath' ||
    /CLIENT_PATH|PRODUCT_PATH|DEFAULT_PATH|FILENAME_PREFIX/i.test(title)
  ) {
    return 'output_path'
  }

  // Image upload
  if (classType === 'LoadImage' && key === 'image') return 'image'

  // Numeric types
  if (
    classType === 'easy int' || classType === 'PrimitiveInt' ||
    classType === 'easy float' || classType === 'PrimitiveFloat' ||
    typeof value === 'number'
  ) {
    return 'number'
  }

  // Textarea
  if (/Multiline|CLIPText/i.test(classType)) return 'textarea'

  // Boolean toggle
  if (typeof value === 'boolean') return 'toggle'

  // String fallback
  return 'text'
}
