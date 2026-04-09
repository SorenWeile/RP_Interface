import { useCallback, useRef, useState } from 'react'
import { uploadImage, createImageEditBatch, getBatchStatus, cancelBatch, type BatchJobStatus } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import ClientProjectPicker from '@/components/ClientProjectPicker'

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadState = 'empty' | 'uploading' | 'ready' | 'error'

interface ImageSlot {
  preview: string | null
  filename: string | null
  state: UploadState
}

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }
const REF_COUNT = 4  // Number of reference image slots

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
  | { status: 'idle' | 'submitting' }
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

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  slot,
  label,
  disabled,
  onFile,
  onClear,
  size = 'lg',
}: {
  slot: ImageSlot
  label: string
  disabled?: boolean
  onFile: (file: File) => void
  onClear: () => void
  size?: 'lg' | 'sm'
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && !disabled) onFile(file)
  }

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => !disabled && e.key === 'Enter' && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={cn(
          'relative border-2 border-dashed rounded transition-colors select-none flex flex-col items-center justify-center',
          size === 'lg' ? 'min-h-40' : 'min-h-20',
          disabled ? 'cursor-default opacity-60' : 'cursor-pointer',
          dragging
            ? 'border-primary bg-comfy-canvas'
            : 'border-comfy-border bg-comfy-panel hover:border-primary/60',
        )}
      >
        {slot.preview ? (
          <img src={slot.preview} alt={label} className={cn(
            'object-contain rounded opacity-80',
            size === 'lg' ? 'max-h-48 max-w-full' : 'max-h-16 max-w-full'
          )} />
        ) : (
          <div className={cn('text-center', size === 'lg' ? 'p-6' : 'p-2')}>
            {size === 'lg' && <div className="text-muted-foreground text-3xl mb-2">↓</div>}
            <p className="text-muted-foreground text-xs">{label}</p>
          </div>
        )}
        {slot.state === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/70 rounded">
            <span className="text-muted-foreground text-xs tracking-widest animate-pulse">UPLOADING…</span>
          </div>
        )}
        {slot.state === 'error' && (
          <div className="absolute bottom-0 inset-x-0 bg-destructive/80 text-destructive-foreground text-xs text-center py-0.5 rounded-b">
            upload failed
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
      </div>
      {slot.preview && !disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className={cn(
            'absolute top-1 right-1 flex items-center justify-center rounded-full',
            'w-5 h-5 text-xs bg-background/80 border border-border text-muted-foreground',
            'hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors',
          )}
          title="Remove image"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImageEdit() {
  const [slot, setSlot]               = useState<ImageSlot>(EMPTY_SLOT)
  const [refSlots, setRefSlots]       = useState<ImageSlot[]>(Array(REF_COUNT).fill(EMPTY_SLOT))
  const [prompt, setPrompt]           = useState('')
  const [count, setCount]             = useState(1)
  const [clientPath, setClientPath]   = useState('')
  const [productPath, setProductPath] = useState('')
  const [filePrefix, setFilePrefix]   = useState('Shot001')
  const [stage, setStage]             = useState<Stage>({ status: 'idle' })
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Upload ───────────────────────────────────────────────────────────────────

  const uploadSlot = useCallback(
    async (file: File, setSlot: (fn: (prev: ImageSlot) => ImageSlot) => void) => {
      const preview = URL.createObjectURL(file)
      setSlot(() => ({ preview, filename: null, state: 'uploading' }))
      try {
        const { filename } = await uploadImage(file)
        setSlot(() => ({ preview, filename, state: 'ready' }))
      } catch {
        setSlot(() => ({ preview, filename: null, state: 'error' }))
      }
    },
    [],
  )

  const handleFile = useCallback((file: File) => {
    uploadSlot(file, setSlot)
  }, [uploadSlot])

  const handleRefFile = useCallback((index: number, file: File) => {
    uploadSlot(file, (fn) =>
      setRefSlots((prev) => prev.map((s, i) => (i === index ? fn(s) : s)))
    )
  }, [uploadSlot])

  const clearMain = () => setSlot(EMPTY_SLOT)
  const clearRef = (index: number) =>
    setRefSlots((prev) => prev.map((s, i) => (i === index ? EMPTY_SLOT : s)))

  // ── Polling ──────────────────────────────────────────────────────────────────

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

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!slot.filename) return
    setStage({ status: 'submitting' })
    
    const readyRefs = refSlots
      .filter((s) => s.state === 'ready' && s.filename)
      .map((s) => s.filename!)
    
    try {
      const { batch_id, total } = await createImageEditBatch({
        filename: slot.filename,
        prompt,
        ref_images: readyRefs,
        count,
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

  // ── Cancel ───────────────────────────────────────────────────────────────────

  const handleCancel = async () => {
    if (stage.status !== 'running') return
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try { await cancelBatch(stage.batch.batchId) } catch { /* best-effort */ }
    setStage({ status: 'idle' })
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setStage({ status: 'idle' })
    // Keep slot so user can run again without re-uploading
  }

  const resetFull = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setSlot(EMPTY_SLOT)
    setStage({ status: 'idle' })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isBusy    = stage.status === 'submitting' || stage.status === 'running'
  const canSubmit = slot.state === 'ready' && prompt.trim().length > 0 && !isBusy

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Input image */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Input Image</label>
        <DropZone
          slot={slot}
          label="Drop image here or click to browse"
          disabled={isBusy}
          onFile={handleFile}
          onClear={clearMain}
        />
      </div>

      {/* Reference images */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Reference Images (Optional)</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {refSlots.map((refSlot, index) => (
            <DropZone
              key={index}
              slot={refSlot}
              label={`Ref ${index + 1}`}
              disabled={isBusy}
              onFile={(file) => handleRefFile(index, file)}
              onClear={() => clearRef(index)}
              size="sm"
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Upload up to 4 reference images to guide the editing process
        </p>
      </div>

      <Separator />

      {/* Prompt + count slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <label className="text-xs text-muted-foreground uppercase tracking-widest shrink-0">
            Edit Instruction
          </label>
          {/* Runs slider */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Runs</span>
            <input
              type="range"
              min={1}
              max={10}
              value={count}
              disabled={isBusy}
              onChange={e => setCount(Number(e.target.value))}
              className="w-24 accent-primary disabled:opacity-50"
            />
            <span className="text-xs font-medium text-foreground w-4 text-right">{count}</span>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isBusy}
          rows={6}
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'resize-none disabled:opacity-60',
          )}
          placeholder='Describe the edit to apply, e.g. "change the color of the bike to bright yellow"'
        />
      </div>

      <Separator />

      {/* Output path */}
      <ClientProjectPicker
        clientPath={clientPath}
        productPath={productPath}
        filePrefix={filePrefix}
        onClientPath={setClientPath}
        onProductPath={setProductPath}
        onFilePrefix={setFilePrefix}
        disabled={isBusy}
      />

      {/* Submit */}
      {(stage.status === 'idle' || stage.status === 'submitting') && (
        <div className="flex items-center gap-3 pt-1">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {stage.status === 'submitting'
              ? 'Queuing…'
              : count === 1 ? 'Generate' : `Generate — ${count} runs`}
          </Button>
          {slot.preview && (
            <Button variant="outline" size="sm" onClick={resetFull}>Reset</Button>
          )}
        </div>
      )}

      {/* Batch progress */}
      {(stage.status === 'running' || stage.status === 'complete') && (() => {
        const { batch } = stage
        const pct = batch.total > 0 ? Math.round((batch.nDone / batch.total) * 100) : 0

        return (
          <div className="space-y-4">

            {/* Overall progress */}
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

            {/* Run dots */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Runs</span>
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: batch.total }).map((_, i) => {
                  const job = batch.jobs.find(j => j.run === i + 1)
                  return <RunDot key={i} status={job?.status ?? 'pending'} />
                })}
              </div>
              <span className="text-xs text-muted-foreground ml-1">
                {batch.nDone}/{batch.total}
              </span>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex gap-3 flex-wrap">
              {stage.status === 'running' && (
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Cancel pending
                </Button>
              )}
              {stage.status === 'complete' && (
                <>
                  {batch.total === 1 && batch.jobs[0]?.images?.length > 0 ? (
                    // Single run — offer individual image download
                    batch.jobs[0].images.map((img, i) => (
                      <Button key={i} variant="outline" size="sm" asChild>
                        <a href={`/api/image?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`} download={img.filename}>
                          Download {img.filename}
                        </a>
                      </Button>
                    ))
                  ) : (
                    <a href={`/api/batch/${batch.batchId}/download`} download>
                      <Button variant="outline" size="sm">Download ZIP</Button>
                    </a>
                  )}
                  <Button variant="outline" size="sm" onClick={reset}>New run</Button>
                  <Button variant="ghost" size="sm" onClick={resetFull}>Reset all</Button>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Error */}
      {stage.status === 'error' && (
        <div className="space-y-3">
          <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
            {stage.message}
          </p>
          <Button variant="outline" size="sm" onClick={resetFull}>Reset</Button>
        </div>
      )}
    </div>
  )
}
