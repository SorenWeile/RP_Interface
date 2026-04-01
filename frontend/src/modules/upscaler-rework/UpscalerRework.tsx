import { useCallback, useRef, useState } from 'react'
import { uploadImage, createUpscaleReworkBatch, getBatchStatus, cancelBatch, type BatchJobStatus } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import ClientProjectPicker from '@/components/ClientProjectPicker'

// ── Model catalogue ───────────────────────────────────────────────────────────

const MODELS = [
  '4xUltrasharp_4xUltrasharpV10.pt',
  '4xLexicaDAT2_otf.pth',
  '4xRealWebPhoto_v4.pth',
  '4xPurePhoto-RealPLSKR.pth',
  '4xRealWebPhoto_v3_atd.pth',
  '4xNomos8kSCHAT-L.pth',
] as const

const MODEL_LABEL: Record<string, string> = {
  '4xUltrasharp_4xUltrasharpV10.pt': 'Ultrasharp V10',
  '4xLexicaDAT2_otf.pth':            'Lexica DAT2',
  '4xRealWebPhoto_v4.pth':           'RealWebPhoto v4',
  '4xPurePhoto-RealPLSKR.pth':       'PurePhoto PLSKR',
  '4xRealWebPhoto_v3_atd.pth':       'RealWebPhoto v3 ATD',
  '4xNomos8kSCHAT-L.pth':            'Nomos 8k SCHAT-L',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BatchInfo {
  batchId: string
  total: number
  nQueued: number
  nProcessing: number
  nDone: number
  nError: number
  jobs: BatchJobStatus[]
}

type Stage =
  | { status: 'idle' | 'uploading' | 'ready' | 'submitting' }
  | { status: 'running' | 'complete'; batch: BatchInfo }
  | { status: 'error'; message: string }

// ── Status dot ────────────────────────────────────────────────────────────────

function RunDot({ status }: { status: BatchJobStatus['status'] | 'pending' }) {
  return (
    <span
      title={status}
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-sm',
        status === 'done'       && 'bg-green-500',
        status === 'processing' && 'bg-primary animate-pulse',
        status === 'error'      && 'bg-destructive',
        (status === 'queued' || status === 'pending') && 'bg-muted border border-border',
      )}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UpscalerRework() {
  const [stage, setStage]               = useState<Stage>({ status: 'idle' })
  const [preview, setPreview]           = useState<string | null>(null)
  const [filename, setFilename]         = useState<string | null>(null)
  const [dragging, setDragging]         = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([...MODELS])
  const [runsPerModel, setRunsPerModel] = useState(4)
  const [clientPath, setClientPath]     = useState('')
  const [productPath, setProductPath]   = useState('')
  const [filePrefix, setFilePrefix]     = useState('')

  const fileInput  = useRef<HTMLInputElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    setPreview(URL.createObjectURL(file))
    setFilename(null)
    setStage({ status: 'uploading' })

    uploadImage(file)
      .then((r) => { setFilename(r.filename); setStage({ status: 'ready' }) })
      .catch((e) => setStage({ status: 'error', message: String(e) }))
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Model toggle ────────────────────────────────────────────────────────────

  const toggleModel = (model: string) => {
    setSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model],
    )
  }

  const toggleAll = () => {
    setSelectedModels(prev => prev.length === MODELS.length ? [] : [...MODELS])
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  const startPolling = useCallback((batchId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await getBatchStatus(batchId)
        const isDone = s.done + s.error >= s.total
        const batch: BatchInfo = {
          batchId: s.batch_id,
          total: s.total,
          nQueued: s.queued,
          nProcessing: s.processing,
          nDone: s.done,
          nError: s.error,
          jobs: s.jobs,
        }
        setStage({ status: isDone ? 'complete' : 'running', batch })
        if (isDone) {
          clearInterval(pollRef.current!)
          pollRef.current = null
        }
      } catch (e) {
        setStage({ status: 'error', message: String(e) })
        clearInterval(pollRef.current!)
        pollRef.current = null
      }
    }, 2500)
  }, [])

  // ── Start batch ─────────────────────────────────────────────────────────────

  const startBatch = async () => {
    if (!filename || selectedModels.length === 0) return
    setStage({ status: 'submitting' })
    try {
      const { batch_id, total } = await createUpscaleReworkBatch({
        filename,
        models: selectedModels,
        runs_per_model: runsPerModel,
        client_path: clientPath,
        product_path: productPath,
        filename_prefix: filePrefix,
      })
      const batch: BatchInfo = {
        batchId: batch_id, total,
        nQueued: total, nProcessing: 0, nDone: 0, nError: 0, jobs: [],
      }
      setStage({ status: 'running', batch })
      startPolling(batch_id)
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
    }
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────

  const handleCancel = async () => {
    if (stage.status !== 'running') return
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try {
      await cancelBatch(stage.batch.batchId)
    } catch { /* best-effort */ }
    setStage({ status: 'ready' })
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setStage({ status: 'idle' })
    setPreview(null)
    setFilename(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const isBusy = stage.status === 'uploading' || stage.status === 'submitting' || stage.status === 'running'
  const totalExpected = selectedModels.length * runsPerModel

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Drop zone */}
      <div
        role="button" tabIndex={0}
        onClick={() => !isBusy && fileInput.current?.click()}
        onKeyDown={(e) => !isBusy && e.key === 'Enter' && fileInput.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={cn(
          'relative border-2 border-dashed rounded transition-colors select-none',
          'flex flex-col items-center justify-center min-h-40',
          isBusy ? 'cursor-default opacity-60' : 'cursor-pointer',
          dragging
            ? 'border-primary bg-comfy-canvas'
            : 'border-comfy-border bg-comfy-panel hover:border-primary/60',
        )}
      >
        {preview ? (
          <img src={preview} alt="preview" className="max-h-48 max-w-full object-contain rounded opacity-80" />
        ) : (
          <div className="text-center p-6">
            <div className="text-muted-foreground text-3xl mb-2">↓</div>
            <p className="text-muted-foreground text-sm">Drop image here or click to browse</p>
          </div>
        )}
        {stage.status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/70 rounded">
            <span className="text-muted-foreground text-xs tracking-widest animate-pulse">UPLOADING…</span>
          </div>
        )}
      </div>

      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFileChange} />

      {/* ── Config form (shown until batch starts) ──────────────────────────── */}
      {(stage.status === 'idle' || stage.status === 'ready' || stage.status === 'submitting') && (
        <div className="space-y-4">

          {/* Output path fields */}
          <ClientProjectPicker
            clientPath={clientPath}
            productPath={productPath}
            filePrefix={filePrefix}
            onClientPath={setClientPath}
            onProductPath={setProductPath}
            onFilePrefix={setFilePrefix}
          />

          <Separator />

          {/* Model selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">Models</span>
              <button
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {selectedModels.length === MODELS.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MODELS.map(model => {
                const active = selectedModels.includes(model)
                return (
                  <button
                    key={model}
                    onClick={() => toggleModel(model)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors border',
                      active
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-comfy-panel border-border text-muted-foreground hover:text-foreground hover:border-primary/30',
                    )}
                  >
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      active ? 'bg-primary' : 'bg-muted-foreground',
                    )} />
                    {MODEL_LABEL[model]}
                  </button>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Runs per model */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-widest">Runs per model</span>
            <div className="flex items-center gap-2">
              {[1, 2, 4, 8].map(n => (
                <button
                  key={n}
                  onClick={() => setRunsPerModel(n)}
                  className={cn(
                    'w-9 h-8 rounded text-sm transition-colors border',
                    runsPerModel === n
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Summary + Start */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              className="flex-1"
              onClick={startBatch}
              disabled={!filename || selectedModels.length === 0 || stage.status === 'submitting'}
            >
              {stage.status === 'submitting'
                ? 'Queuing…'
                : `Start Batch — ${totalExpected * 2} images (${selectedModels.length} models × ${runsPerModel} runs × 4K+8K)`}
            </Button>
            {preview && (
              <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
            )}
          </div>
        </div>
      )}

      {/* ── Batch progress ───────────────────────────────────────────────────── */}
      {(stage.status === 'running' || stage.status === 'complete') && (() => {
        const { batch } = stage
        const pct = batch.total > 0 ? Math.round((batch.nDone / batch.total) * 100) : 0

        return (
          <div className="space-y-4">

            {/* Overall */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {stage.status === 'complete'
                    ? `Complete — ${batch.nDone} done${batch.nError > 0 ? `, ${batch.nError} errors` : ''}`
                    : `${batch.nDone} / ${batch.total} done  ·  ${batch.nProcessing} processing  ·  ${batch.nQueued} queued`}
                </span>
                <span>{pct}%</span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>

            <Separator />

            {/* Per-model breakdown */}
            <div className="space-y-2">
              {selectedModels.map(model => {
                const runs = batch.jobs.filter(j => j.model === model)
                const nDone = runs.filter(r => r.status === 'done').length
                return (
                  <div key={model} className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-36 truncate shrink-0">
                      {MODEL_LABEL[model]}
                    </span>
                    <div className="flex gap-1">
                      {Array.from({ length: runsPerModel }).map((_, i) => {
                        const run = runs.find(r => r.run === i + 1)
                        return <RunDot key={i} status={run?.status ?? 'pending'} />
                      })}
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">
                      {nDone}/{runsPerModel}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              {stage.status === 'running' && (
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Cancel pending
                </Button>
              )}
              {stage.status === 'complete' && (
                <>
                  <a href={`/api/batch/${stage.batch.batchId}/download`} download>
                    <Button variant="outline" size="sm">Download ZIP</Button>
                  </a>
                  <Button variant="outline" size="sm" onClick={reset}>
                    New batch
                  </Button>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {stage.status === 'error' && (
        <div className="space-y-3">
          <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
            {stage.message}
          </p>
          <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
        </div>
      )}
    </div>
  )
}
