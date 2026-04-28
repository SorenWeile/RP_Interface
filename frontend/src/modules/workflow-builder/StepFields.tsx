import { useMemo, useRef, useState } from 'react'
import { Plus, X, GripVertical, ChevronDown, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { buildFieldDef } from './detect'
import ToolPreview from './ToolPreview'
import type { DetectedInput, FieldDef, FieldType } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<FieldType, string> = {
  image:    'border-l-primary',
  text:     'border-l-muted-foreground/40',
  textarea: 'border-l-violet-500/60',
  number:   'border-l-orange-400/70',
  slider:   'border-l-amber-400/70',
  select:   'border-l-green-500/60',
  toggle:   'border-l-teal-500/60',
  user:     'border-l-yellow-500/60',
}

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'image',    label: 'Image Upload' },
  { value: 'text',     label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number',   label: 'Number' },
  { value: 'slider',   label: 'Slider' },
  { value: 'select',   label: 'Select' },
  { value: 'toggle',   label: 'Toggle' },
  { value: 'user',     label: 'User (auto)' },
]

const SELECT_CLS =
  'w-full px-2 py-1.5 rounded border border-input bg-background text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-ring'

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureUniqueId(id: string, existing: FieldDef[]): string {
  let candidate = id
  let n = 1
  while (existing.some(f => f.id === candidate)) candidate = `${id}_${++n}`
  return candidate
}

// ── OptionsEditor ─────────────────────────────────────────────────────────────

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [val,    setVal]    = useState('')

  const add = () => {
    const t = val.trim()
    if (t && !options.includes(t)) onChange([...options, t])
    setVal('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <span key={o} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px]">
          {o}
          <button onClick={() => onChange(options.filter(x => x !== o))} className="hover:text-destructive">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          type="text"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={add}
          onKeyDown={e => e.key === 'Enter' && add()}
          className="w-20 px-2 py-0.5 text-[11px] rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground text-[11px] hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="w-2.5 h-2.5" /> add
        </button>
      )}
    </div>
  )
}

// ── FieldCard ─────────────────────────────────────────────────────────────────

function FieldCard({
  field, onUpdate, onRemove, isDragOver,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  field:       FieldDef
  onUpdate:    (patch: Partial<FieldDef>) => void
  onRemove:    () => void
  isDragOver:  boolean
  onDragStart: () => void
  onDragOver:  (e: React.DragEvent) => void
  onDrop:      () => void
  onDragEnd:   () => void
}) {
  const labelCls = 'text-[10px] text-muted-foreground uppercase tracking-wider'
  const inputCls = 'text-xs h-7 px-2'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'relative pl-6 pr-3 pt-2.5 pb-3 rounded-md border-l-4 border border-border bg-card transition-colors',
        TYPE_COLOR[field.type] ?? 'border-l-border',
        isDragOver && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
      )}
    >
      {/* Drag handle */}
      <GripVertical className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 cursor-grab" />

      {/* Remove */}
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 text-muted-foreground/50 hover:text-destructive transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Header */}
      <div className="text-xs text-foreground mb-2 pr-4 font-medium flex items-center gap-1.5">
        {field.label || '(no label)'}
        <span className="text-muted-foreground font-normal text-[10px]">
          · node {field.node_id} · {field.input_key}
        </span>
      </div>

      {/* Editable properties */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {/* Label */}
        <div className="col-span-2 space-y-1">
          <label className={labelCls}>Label</label>
          <Input value={field.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} />
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label className={labelCls}>Type</label>
          <select
            value={field.type}
            onChange={e => onUpdate({ type: e.target.value as FieldType })}
            className={cn(SELECT_CLS, 'text-xs h-7')}
          >
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Required toggle */}
        <div className="space-y-1 flex flex-col justify-end">
          <label className={labelCls}>Required</label>
          <label className="flex items-center gap-2 cursor-pointer h-7">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="w-3.5 h-3.5 accent-primary"
            />
            <span className="text-xs text-muted-foreground">{field.required ? 'Yes' : 'No'}</span>
          </label>
        </div>

        {/* Group — only for image fields */}
        {field.type === 'image' && (
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Group <span className="normal-case font-normal">(same name = side-by-side)</span></label>
            <Input
              value={field.group ?? ''}
              placeholder="e.g. reference_images"
              onChange={e => onUpdate({ group: e.target.value || undefined })}
              className={inputCls}
            />
          </div>
        )}

        {/* User type info */}
        {field.type === 'user' && (
          <div className="col-span-2 px-2 py-1.5 rounded bg-yellow-500/10 border border-yellow-500/20 text-[10px] text-yellow-400">
            Username is automatically injected at runtime — no user input needed.
          </div>
        )}

        {/* Type-specific options */}
        {(field.type === 'text' || field.type === 'textarea') && (
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Placeholder</label>
            <Input
              value={field.placeholder ?? ''}
              onChange={e => onUpdate({ placeholder: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {field.type === 'textarea' && (
          <div className="space-y-1">
            <label className={labelCls}>Rows</label>
            <Input
              type="number" min={2} max={12}
              value={field.rows ?? 4}
              onChange={e => onUpdate({ rows: parseInt(e.target.value) || 4 })}
              className={inputCls}
            />
          </div>
        )}
        {(field.type === 'number' || field.type === 'slider') && (
          <>
            <div className="space-y-1">
              <label className={labelCls}>Min</label>
              <Input type="number" value={field.min ?? 0} onChange={e => onUpdate({ min: parseFloat(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Max</label>
              <Input type="number" value={field.max ?? 100} onChange={e => onUpdate({ max: parseFloat(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Step</label>
              <Input type="number" value={field.step ?? 1} onChange={e => onUpdate({ step: parseFloat(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Default</label>
              <Input type="number" value={(field.default as number) ?? 0} onChange={e => onUpdate({ default: parseFloat(e.target.value) })} className={inputCls} />
            </div>
          </>
        )}
        {field.type === 'select' && (
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Options</label>
            <OptionsEditor
              options={field.options ?? []}
              onChange={opts => onUpdate({ options: opts, default: opts.includes(field.default as string) ? field.default : opts[0] })}
            />
          </div>
        )}
        {field.type === 'toggle' && (
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Default</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!(field.default)}
                onChange={e => onUpdate({ default: e.target.checked })}
                className="w-3.5 h-3.5 accent-primary"
              />
              <span className="text-xs text-muted-foreground">{field.default ? 'On' : 'Off'}</span>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AddFromTable popover ──────────────────────────────────────────────────────

function AddPopover({
  candidates, onAdd, onClose,
}: {
  candidates: DetectedInput[]
  onAdd: (d: DetectedInput) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={ref}
      className="absolute top-full mt-1 left-0 z-50 w-80 max-h-60 overflow-y-auto bg-card border border-border rounded-md shadow-xl"
    >
      {candidates.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground text-center">
          All detectable inputs are already added.
        </p>
      ) : (
        candidates.map(d => (
          <button
            key={`${d.node_id}:${d.input_key}`}
            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left"
            onClick={() => { onAdd(d); onClose() }}
          >
            <span>
              <span className="font-mono text-muted-foreground">{d.node_id}·</span>{' '}
              <span className="text-foreground">{d.title}</span>
              <span className="text-muted-foreground ml-1">/ {d.input_key}</span>
            </span>
            <span className="shrink-0 text-[10px] text-primary border border-primary/20 bg-primary/10 rounded px-1.5 py-0.5">
              {d.detected_type}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  detected:       DetectedInput[]
  fields:         FieldDef[]
  setFields:      (v: FieldDef[]) => void
  pathNodeId:     string | null
  setPathNodeId:  (v: string | null) => void
  outputPathNodes: Array<{ node_id: string; title: string }>
  onBack?:        () => void
  onNext:         () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StepFields({
  detected, fields, setFields,
  pathNodeId, setPathNodeId, outputPathNodes,
  onBack, onNext,
}: Props) {
  const [showAdd,    setShowAdd]    = useState(false)
  const [dragId,     setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [err,        setErr]        = useState('')

  // Inputs not yet assigned to a field and not auto/path
  const usedKeys = useMemo(() => new Set(fields.map(f => `${f.node_id}:${f.input_key}`)), [fields])
  const pathNodeInputKeys = useMemo(() => {
    if (!pathNodeId) return new Set<string>()
    return new Set(
      detected
        .filter(d => d.node_id === pathNodeId)
        .map(d => `${d.node_id}:${d.input_key}`)
    )
  }, [pathNodeId, detected])

  const addableCandidates = useMemo(() =>
    detected.filter(d => {
      const k = `${d.node_id}:${d.input_key}`
      return (
        !usedKeys.has(k) &&
        !pathNodeInputKeys.has(k) &&
        d.detected_type !== 'auto_seed' &&
        d.detected_type !== 'output_path'
      )
    }),
  [detected, usedKeys, pathNodeInputKeys])

  const updateField = (id: string, patch: Partial<FieldDef>) =>
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f))

  const removeField = (id: string) => setFields(fields.filter(f => f.id !== id))

  const addFromDetected = (d: DetectedInput) => {
    const def = buildFieldDef(d)
    def.id = ensureUniqueId(def.id, fields)
    setFields([...fields, def])
  }

  // Drag-to-reorder
  const handleDragStart = (id: string) => setDragId(id)
  const handleDragOver  = (id: string, e: React.DragEvent) => { e.preventDefault(); setDragOverId(id) }
  const handleDrop      = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const srcIdx = fields.findIndex(f => f.id === dragId)
    const dstIdx = fields.findIndex(f => f.id === targetId)
    if (srcIdx < 0 || dstIdx < 0) return
    const next = [...fields]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(dstIdx, 0, moved)
    setFields(next)
    setDragId(null); setDragOverId(null)
  }
  const handleDragEnd = () => { setDragId(null); setDragOverId(null) }

  const handleNext = () => {
    if (fields.length === 0) { setErr('Add at least one field before continuing.'); return }
    setErr(''); onNext()
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">

      {/* Header — spans full width */}
      <div className="shrink-0">
        <h2 className="text-lg font-medium text-foreground">Configure Fields</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose which inputs to expose, reorder them, and tweak each control. The preview updates live.
        </p>
      </div>

      {/* Two-column body */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
      {/* ── LEFT ── */}
      <div className="space-y-4 overflow-y-auto pb-4 min-h-0">

        {/* Output path node picker */}
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Folder className="w-3.5 h-3.5 text-muted-foreground" />
            Output Path Node
            <span
              className="ml-auto text-muted-foreground cursor-help border border-border rounded-full w-4 h-4 flex items-center justify-center text-[9px]"
              title="Select an INDGOutputPath node to enable the client / project / filename picker on the runner."
            >
              ?
            </span>
          </div>
          <select
            value={pathNodeId ?? ''}
            onChange={e => setPathNodeId(e.target.value || null)}
            className={cn(SELECT_CLS, 'text-xs')}
          >
            <option value="">— None —</option>
            {outputPathNodes.map(n => (
              <option key={n.node_id} value={n.node_id}>
                {n.node_id} · {n.title}
              </option>
            ))}
          </select>
          {outputPathNodes.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No INDGOutputPath node detected in this workflow.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Leave blank to hide the client / project picker on the runner.
          </p>
        </div>

        {/* Field list header */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Field list
          </span>
          <span className="text-[10px] text-muted-foreground">
            {fields.length} exposed
          </span>
        </div>

        {/* Field cards */}
        {fields.length === 0 && (
          <div className="text-xs text-muted-foreground text-center border border-dashed border-border rounded-md py-6">
            No fields yet. Use "+ Add from table" below.
          </div>
        )}
        {fields.map(f => (
          <FieldCard
            key={f.id}
            field={f}
            onUpdate={patch => updateField(f.id, patch)}
            onRemove={() => removeField(f.id)}
            isDragOver={dragOverId === f.id}
            onDragStart={() => handleDragStart(f.id)}
            onDragOver={e => handleDragOver(f.id, e)}
            onDrop={() => handleDrop(f.id)}
            onDragEnd={handleDragEnd}
          />
        ))}

        {/* Add from table */}
        <div className="relative inline-block">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdd(s => !s)}
            className="text-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add from table
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
          {showAdd && (
            <AddPopover
              candidates={addableCandidates}
              onAdd={addFromDetected}
              onClose={() => setShowAdd(false)}
            />
          )}
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>

      {/* ── RIGHT: Live preview ── */}
      <ToolPreview
        fields={fields}
        hasPathNode={pathNodeId !== null}
      />
      </div>{/* end two-column grid */}

      {/* Nav buttons — spans full width */}
      <div className="shrink-0 flex justify-between">
        {onBack
          ? <Button variant="outline" onClick={onBack}>← Back</Button>
          : <span />
        }
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
