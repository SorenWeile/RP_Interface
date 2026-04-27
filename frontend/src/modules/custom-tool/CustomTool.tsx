import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  getTool, runTool, runToolBatch, getToolBatchStatus, cancelToolBatch,
  getStatus, connectProgress, imageUrl, toolBatchDownloadUrl,
  type ProgressEvent,
} from '@/api/client'
import { fetchAndDownload } from '@/lib/download'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/Toaster'
import ClientProjectPicker from '@/components/ClientProjectPicker'
import FieldRenderer from './FieldRenderer'
import { groupFields } from '@/modules/workflow-builder/detect'
import type { FieldDef, ParsedToolDef, ToolBatchStatus, ToolDef } from '@/modules/workflow-builder/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTool(raw: ToolDef): ParsedToolDef {
  return {
    id:         raw.id,
    name:       raw.name,
    description:raw.description,
    icon:       raw.icon,
    is_builtin: raw.is_builtin,
    created_at: raw.created_at,
    fields:     JSON.parse(raw.fields_json || '[]'),
    pathNodes:  raw.path_nodes ? JSON.parse(raw.path_nodes) : null,
    autoNodes:  JSON.parse(raw.auto_nodes || '[]'),
  }
}

function defaultValue(field: FieldDef): unknown {
  if (field.default !== undefined) return field.default
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'select':  return ''
    case 'image':   return null
    case 'number':
    case 'slider':  return field.min ?? 0
    case 'toggle':  return false
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  toolId:   string
  onEdit?:  () => void
  onDelete?: () => void
}

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'processing'; pct: number }
  | { status: 'batch'; batchId: string; bs: ToolBatchStatus }
  | { status: 'done'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomTool({ toolId, onEdit, onDelete }: Props) {
  const [tool,        setTool]        = useState<ParsedToolDef | null>(null)
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [values,      setValues]      = useState<Record<string, unknown>>({})
  const [clientPath,  setClientPath]  = useState('')
  const [productPath, setProductPath] = useState('')
  const [filePrefix,  setFilePrefix]  = useState('Shot001')
  const [batchCount,  setBatchCount]  = useState(1)
  const [stage,        setStage]        = useState<Stage>({ status: 'idle' })
  const [formKey,      setFormKey]      = useState(0)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const disconnectWs = useRef<(() => void) | null>(null)
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { toast }    = useToast()

  // ── Load tool ────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    getTool(toolId)
      .then(raw => {
        const parsed = parseTool(raw)
        setTool(parsed)
        const defaults: Record<string, unknown> = {}
        for (const f of parsed.fields) defaults[f.id] = defaultValue(f)
        setValues(defaults)
      })
      .catch(e => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [toolId])

  // ── Cleanup on unmount ───────────────────────────────────────────────────────

  useEffect(() => () => {
    disconnectWs.current?.()
    if (batchPollRef.current) clearInterval(batchPollRef.current)
  }, [])

  // ── Field values ─────────────────────────────────────────────────────────────

  const setFieldValue = useCallback((fieldId: string, val: unknown) => {
    setValues(prev => ({ ...prev, [fieldId]: val }))
  }, [])

  // ── Derived state ────────────────────────────────────────────────────────────

  const isBusy =
    stage.status === 'submitting' ||
    stage.status === 'processing' ||
    (stage.status === 'batch' && (stage.bs.queued > 0 || stage.bs.processing > 0))

  const canRun =
    !isBusy &&
    (tool?.fields ?? []).every(f =>
      !f.required || (values[f.id] !== null && values[f.id] !== undefined && values[f.id] !== '')
    )

  // ── Run single ───────────────────────────────────────────────────────────────

  const runSingle = async () => {
    if (!tool) return
    setStage({ status: 'submitting' })
    try {
      const body = {
        values,
        ...(tool.pathNodes ? { path_client: clientPath, path_product: productPath, path_filename: filePrefix } : {}),
      }
      const { prompt_id, client_id } = await runTool(toolId, body)
      setStage({ status: 'processing', pct: 0 })

      disconnectWs.current?.()
      disconnectWs.current = connectProgress(client_id, prompt_id, (event: ProgressEvent) => {
        if (event.type === 'progress') {
          const pct = event.max > 0 ? Math.round((event.value / event.max) * 100) : 0
          setStage({ status: 'processing', pct })
        } else if (event.type === 'complete') {
          const poll = setInterval(async () => {
            try {
              const s = await getStatus(prompt_id)
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'done', images: s.images ?? [] })
                toast('Done!', 'success')
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
                toast('Run failed', 'error')
              }
            } catch {
              clearInterval(poll)
              setStage({ status: 'error', message: 'Status poll failed' })
            }
          }, 800)
        } else if (event.type === 'error') {
          setStage({ status: 'error', message: event.message ?? 'Unknown error' })
          toast('Run error', 'error')
        }
      })
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
      toast('Failed to start run', 'error')
    }
  }

  // ── Run batch ────────────────────────────────────────────────────────────────

  const runBatch = async () => {
    if (!tool) return
    setStage({ status: 'submitting' })
    try {
      const body = {
        values,
        count: batchCount,
        ...(tool.pathNodes ? { path_client: clientPath, path_product: productPath, path_filename: filePrefix } : {}),
      }
      const { batch_id } = await runToolBatch(toolId, body)

      const startPolling = (id: string) => {
        if (batchPollRef.current) clearInterval(batchPollRef.current)
        batchPollRef.current = setInterval(async () => {
          try {
            const bs = await getToolBatchStatus(id)
            setStage({ status: 'batch', batchId: id, bs })
            if (bs.queued === 0 && bs.processing === 0) {
              clearInterval(batchPollRef.current!)
              batchPollRef.current = null
              if (bs.error === 0) toast('Batch complete!', 'success')
              else toast(`Batch done — ${bs.error} error(s)`, 'error')
            }
          } catch {
            clearInterval(batchPollRef.current!)
            batchPollRef.current = null
          }
        }, 1000)
      }

      const bs = await getToolBatchStatus(batch_id)
      setStage({ status: 'batch', batchId: batch_id, bs })
      startPolling(batch_id)
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
      toast('Failed to start batch', 'error')
    }
  }

  // ── Cancel batch ─────────────────────────────────────────────────────────────

  const handleCancelBatch = async () => {
    if (stage.status !== 'batch') return
    const id = stage.batchId
    await cancelToolBatch(id).catch(() => {})
    if (batchPollRef.current) { clearInterval(batchPollRef.current); batchPollRef.current = null }
    setStage({ status: 'idle' })
    toast('Batch cancelled', 'info')
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  const resetStage = () => {
    disconnectWs.current?.()
    disconnectWs.current = null
    setStage({ status: 'idle' })
  }

  const resetAll = () => {
    resetStage()
    if (tool) {
      const defaults: Record<string, unknown> = {}
      for (const f of tool.fields) defaults[f.id] = defaultValue(f)
      setValues(defaults)
    }
    setFormKey(k => k + 1)
  }

  // ── Render: loading / error ──────────────────────────────────────────────────

  if (loading) return (
    <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
  )

  if (loadError || !tool) return (
    <div className="text-sm text-destructive">{loadError ?? 'Tool not found'}</div>
  )

  // ── Derived render helpers ───────────────────────────────────────────────────

  const batchDone = stage.status === 'batch' && stage.bs.queued === 0 && stage.bs.processing === 0
  const showActions = stage.status === 'idle' || stage.status === 'submitting'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Tool header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">{tool.name}</h2>
          {tool.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
          )}
        </div>
        {(onEdit || onDelete) && (
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7"
              onClick={() => setMenuOpen(m => !m)}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 w-40 bg-card border border-border rounded-md shadow-xl overflow-hidden"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {onEdit && (
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors"
                    onClick={() => { setMenuOpen(false); onEdit() }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit tool
                  </button>
                )}
                {onDelete && (
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={() => { setMenuOpen(false); setDeleteConfirm(true) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete tool
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Fields */}
      {tool.fields.filter(f => f.type !== 'user').length > 0 && (
        <div className="space-y-4">
          {groupFields(tool.fields.filter(f => f.type !== 'user')).map((grp, i) => (
            <div key={i} className={grp.length > 1 ? 'flex gap-3' : undefined}>
              {grp.map(f => (
                <div key={f.id} className={`space-y-1.5${grp.length > 1 ? ' flex-1 min-w-0' : ''}`}>
                  <label className="text-xs text-muted-foreground uppercase tracking-widest">
                    {f.label}
                    {f.required && <span className="text-destructive ml-1">*</span>}
                  </label>
                  <FieldRenderer
                    key={`${formKey}-${f.id}`}
                    field={f}
                    value={values[f.id]}
                    onChange={v => setFieldValue(f.id, v)}
                    disabled={isBusy}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Output path picker */}
      {tool.pathNodes && (
        <>
          <Separator />
          <ClientProjectPicker
            clientPath={clientPath}
            productPath={productPath}
            filePrefix={filePrefix}
            onClientPath={setClientPath}
            onProductPath={setProductPath}
            onFilePrefix={setFilePrefix}
            disabled={isBusy}
          />
        </>
      )}

      <Separator />

      {/* Action bar */}
      {showActions && (
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={50}
              value={batchCount}
              onChange={e => setBatchCount(Math.max(1, Math.min(50, Number(e.target.value))))}
              disabled={isBusy}
              className="w-16 text-center"
            />
            <span className="text-xs text-muted-foreground shrink-0">×</span>
          </div>
          <Button
            className="flex-1"
            onClick={batchCount > 1 ? runBatch : runSingle}
            disabled={!canRun}
          >
            {stage.status === 'submitting'
              ? 'Queuing…'
              : batchCount > 1
                ? `Run ×${batchCount}`
                : 'Run'}
          </Button>
        </div>
      )}

      {/* Single-run progress */}
      {stage.status === 'processing' && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Processing…</span>
            <span>{stage.pct}%</span>
          </div>
          <Progress value={stage.pct} className="h-1.5" />
        </div>
      )}

      {/* Batch status */}
      {stage.status === 'batch' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {stage.bs.done + stage.bs.error} / {stage.bs.total} complete
              {stage.bs.error > 0 && ` · ${stage.bs.error} error`}
            </span>
            {!batchDone && (
              <Button variant="ghost" size="sm" onClick={handleCancelBatch}>Cancel</Button>
            )}
          </div>
          <Progress
            value={Math.round(((stage.bs.done + stage.bs.error) / stage.bs.total) * 100)}
            className="h-1.5"
          />

          <div className="space-y-1">
            {stage.bs.runs.map(run => (
              <div key={run.run_index} className="flex items-center gap-2 text-xs">
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  run.status === 'done'       ? 'bg-green-500'              :
                  run.status === 'error'      ? 'bg-destructive'            :
                  run.status === 'processing' ? 'bg-primary animate-pulse'  :
                                               'bg-muted-foreground/40'
                )} />
                <span className="text-muted-foreground w-12 shrink-0">Run {run.run_index + 1}</span>
                {run.status === 'done' && run.images.map(img => (
                  <button
                    key={img.filename}
                    onClick={() => fetchAndDownload(imageUrl(img.filename, img.subfolder, img.type), img.filename)}
                    className="text-primary hover:underline truncate max-w-xs"
                  >
                    {img.filename}
                  </button>
                ))}
                {run.status === 'error' && <span className="text-destructive">error</span>}
              </div>
            ))}
          </div>

          {batchDone && (
            <div className="flex gap-3 pt-1 flex-wrap">
              {stage.bs.done > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toast('Downloading…', 'info')
                    fetchAndDownload(toolBatchDownloadUrl(stage.batchId), `batch_${stage.batchId}.zip`)
                  }}
                >
                  Download all (.zip)
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={resetStage}>New run</Button>
              <Button variant="ghost"   size="sm" onClick={resetAll}>Reset all</Button>
            </div>
          )}
        </div>
      )}

      {/* Single-run done */}
      {stage.status === 'done' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            {stage.images.map((img, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                onClick={() => {
                  toast('Downloading…', 'info')
                  fetchAndDownload(imageUrl(img.filename, img.subfolder, img.type), img.filename)
                }}
              >
                Download {img.filename}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={resetStage}>New run</Button>
            <Button variant="ghost"   size="sm" onClick={resetAll}>Reset all</Button>
          </div>
          {stage.images.map(img => (
            <img
              key={img.filename}
              src={imageUrl(img.filename, img.subfolder, img.type)}
              alt="result"
              className="w-full rounded border border-border"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {stage.status === 'error' && (
        <div className="space-y-3">
          <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
            {stage.message}
          </p>
          <Button variant="ghost" size="sm" onClick={resetAll}>Reset</Button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && onDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setDeleteConfirm(false)}
        >
          <div
            className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-foreground font-medium">Delete "{tool.name}"?</h3>
            <p className="text-xs text-muted-foreground">
              This cannot be undone. The workflow and all field configuration will be removed.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
