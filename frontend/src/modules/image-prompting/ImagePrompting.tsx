import { useCallback, useRef, useState } from 'react'
import { createImagePromptingBatch, getBatchStatus, cancelBatch, uploadImage, imageUrl, submitImagePromptingToFarm, getDeadlineStatus, type BatchJobStatus } from '@/api/client'
import { fetchAndDownload } from '@/lib/download'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/Toaster'
import ClientProjectPicker from '@/components/ClientProjectPicker'
import DropZone, { type ImageSlot } from '@/components/DropZone'

// ── Types ─────────────────────────────────────────────────────────────────────

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }
const REF_COUNT = 4  // 11_INPUT_IMAGE_LATENT → 14_INPUT_IMAGE_LATENT

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

type FarmStage =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'queued' | 'rendering'; jobId: string; deadlineJobId: string; progress: number }
  | { status: 'complete'; jobId: string; deadlineJobId: string }
  | { status: 'failed'; message: string }

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

export default function ImagePrompting() {
  const [refSlots, setRefSlots]       = useState<ImageSlot[]>(Array(REF_COUNT).fill(EMPTY_SLOT))
  const [prompt, setPrompt]           = useState('')
  const [count, setCount]             = useState(1)
  const [clientPath, setClientPath]   = useState('')
  const [productPath, setProductPath] = useState('')
  const [filePrefix, setFilePrefix]   = useState('Shot001')
  const [stage, setStage]             = useState<Stage>({ status: 'idle' })
  const [farmStage, setFarmStage]     = useState<FarmStage>({ status: 'idle' })
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null)
  const farmPollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)
  const rawRefFiles                   = useRef<(File | null)[]>(Array(REF_COUNT).fill(null))
  const { toast, dismiss }             = useToast()

  // ── Upload ───────────────────────────────────────────────────────────────────

  const uploadSlot = useCallback(
    async (file: File, setSlotFn: (fn: (prev: ImageSlot) => ImageSlot) => void) => {
      const preview = URL.createObjectURL(file)
      setSlotFn(() => ({ preview, filename: null, state: 'uploading' }))
      try {
        const { filename } = await uploadImage(file)
        setSlotFn(() => ({ preview, filename, state: 'ready' }))
      } catch {
        setSlotFn(() => ({ preview, filename: null, state: 'error' }))
      }
    },
    [],
  )

  const handleRefFile = useCallback((index: number, file: File) => {
    rawRefFiles.current[index] = file
    uploadSlot(file, (fn) =>
      setRefSlots((prev) => prev.map((s, i) => (i === index ? fn(s) : s)))
    )
  }, [uploadSlot])

  const clearRef = (index: number) => {
    rawRefFiles.current[index] = null
    setRefSlots((prev) => prev.map((s, i) => (i === index ? EMPTY_SLOT : s)))
  }

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
          if (s.error > 0 && s.done === 0) {
            toast('All runs failed', 'error')
          } else if (s.error > 0) {
            toast(`${s.done} done, ${s.error} failed`, 'info')
          } else {
            toast(`${s.done} image${s.done !== 1 ? 's' : ''} ready!`, 'success')
          }
        }
      } catch (e) {
        setStage({ status: 'error', message: String(e) })
        clearInterval(pollRef.current!)
        pollRef.current = null
        toast('Batch polling failed', 'error')
      }
    }, 2500)
  }, [toast])

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async () => {
    setStage({ status: 'submitting' })

    const readyRefs = refSlots
      .filter((s) => s.state === 'ready' && s.filename)
      .map((s) => s.filename!)

    try {
      const { batch_id, total } = await createImagePromptingBatch({
        ref_images: readyRefs,
        prompt,
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

  // ── Farm submit ──────────────────────────────────────────────────────────────

  const startFarmPolling = useCallback((jobId: string, deadlineJobId: string) => {
    if (farmPollRef.current) clearInterval(farmPollRef.current)
    farmPollRef.current = setInterval(async () => {
      try {
        const s = await getDeadlineStatus(deadlineJobId)
        if (s.status === 'completed') {
          clearInterval(farmPollRef.current!)
          farmPollRef.current = null
          setFarmStage({ status: 'complete', jobId, deadlineJobId })
          toast('Farm job complete!', 'success')
        } else if (s.status === 'failed') {
          clearInterval(farmPollRef.current!)
          farmPollRef.current = null
          setFarmStage({ status: 'failed', message: 'Deadline reported job failed' })
          toast('Farm job failed', 'error')
        } else {
          const inProgress = s.status === 'rendering'
          setFarmStage({
            status: inProgress ? 'rendering' : 'queued',
            jobId,
            deadlineJobId,
            progress: s.progress ?? 0,
          })
        }
      } catch (e) {
        setFarmStage({ status: 'failed', message: String(e) })
        clearInterval(farmPollRef.current!)
        farmPollRef.current = null
        toast('Farm status polling failed', 'error')
      }
    }, 5000)
  }, [toast])

  const submitToFarm = async () => {
    setFarmStage({ status: 'submitting' })
    try {
      const { job_id, deadline_job_id } = await submitImagePromptingToFarm({
        refFiles: rawRefFiles.current,
        prompt,
        count,
        clientPath: clientPath,
        productPath: productPath,
        filePrefix: filePrefix,
      })
      setFarmStage({ status: 'queued', jobId: job_id, deadlineJobId: deadline_job_id, progress: 0 })
      startFarmPolling(job_id, deadline_job_id)
      toast('Job submitted to farm!', 'success')
    } catch (e) {
      setFarmStage({ status: 'failed', message: String(e) })
      toast('Farm submission failed', 'error')
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
  }

  const resetFull = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (farmPollRef.current) { clearInterval(farmPollRef.current); farmPollRef.current = null }
    setRefSlots(Array(REF_COUNT).fill(EMPTY_SLOT))
    rawRefFiles.current = Array(REF_COUNT).fill(null)
    setPrompt('')
    setStage({ status: 'idle' })
    setFarmStage({ status: 'idle' })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isBusy      = stage.status === 'submitting' || stage.status === 'running'
  const isFarmBusy  = farmStage.status === 'submitting' || farmStage.status === 'queued' || farmStage.status === 'rendering'
  const hasPrompt   = prompt.trim().length > 0
  const canSubmit   = hasPrompt && !isBusy
  const canFarm     = hasPrompt && !isFarmBusy

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-0 min-h-full">

      {/* ── Left column: inputs ───────────────────────────────────────── */}
      <div className="flex-[2] min-w-0 space-y-5 pr-8">

        {/* Reference images */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">
            Image References
          </label>
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
            Upload up to 4 reference images to guide image generation
          </p>
        </div>

        <Separator />

        {/* Prompt + count slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <label className="text-xs text-muted-foreground uppercase tracking-widest shrink-0">
              Prompt Instruction
            </label>
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
            rows={10}
            className={cn(
              'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'resize-y disabled:opacity-60',
            )}
            placeholder='Describe the image to generate, e.g. "A motorcycle on a desert highway at golden hour, wide hero shot..."'
          />
        </div>

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

        <div className="flex items-center gap-3">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {stage.status === 'submitting'
              ? 'Queuing…'
              : count === 1 ? 'Generate' : `Generate — ${count} runs`}
          </Button>
          <Button variant="outline" onClick={submitToFarm} disabled={!canFarm}>
            {farmStage.status === 'submitting' ? 'Submitting…' : 'Submit to Farm'}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetFull}>Reset</Button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-l border-border shrink-0 mr-8" />

      {/* ── Right column: results ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Idle placeholder */}
        {(stage.status === 'idle' || stage.status === 'submitting') && (
          <div className="h-48 flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Results will appear here
          </div>
        )}

        {/* Batch progress / complete */}
        {(stage.status === 'running' || stage.status === 'complete') && (() => {
          const { batch } = stage
          const pct = batch.total > 0 ? Math.round((batch.nDone / batch.total) * 100) : 0
          return (
            <div className="space-y-4">
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
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Runs</span>
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: batch.total }).map((_, i) => {
                    const job = batch.jobs.find(j => j.run === i + 1)
                    return <RunDot key={i} status={job?.status ?? 'pending'} />
                  })}
                </div>
                <span className="text-xs text-muted-foreground ml-1">{batch.nDone}/{batch.total}</span>
              </div>
              <Separator />
              <div className="flex gap-3 flex-wrap">
                {stage.status === 'running' && (
                  <Button variant="outline" size="sm" onClick={handleCancel}>Cancel pending</Button>
                )}
                {stage.status === 'complete' && (
                  <>
                    {batch.total === 1 && batch.jobs[0]?.images?.length > 0 ? (
                      batch.jobs[0].images.map((img, i) => (
                        <Button key={i} variant="outline" size="sm" onClick={() => { toast('Downloading…', 'info'); fetchAndDownload(imageUrl(img.filename, img.subfolder ?? '', img.type ?? 'output'), img.filename) }}>
                          Download {img.filename}
                        </Button>
                      ))
                    ) : (
                      <Button variant="outline" size="sm" onClick={async () => {
                        const id = toast('Preparing ZIP…', 'loading', 0)
                        try {
                          const res = await fetch(`/api/batch/${batch.batchId}/download`)
                          if (!res.ok) throw new Error('Download failed')
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `batch_${batch.batchId}.zip`
                          a.click()
                          URL.revokeObjectURL(url)
                          toast('ZIP downloaded!', 'success')
                        } catch {
                          toast('Download failed', 'error')
                        } finally {
                          dismiss(id)
                        }
                      }}>
                        Download ZIP
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={reset}>New run</Button>
                    <Button variant="ghost" size="sm" onClick={resetFull}>Reset all</Button>
                  </>
                )}
              </div>
              {stage.status === 'complete' && batch.total === 1 && batch.jobs[0]?.images?.map(img => (
                <img key={img.filename} src={imageUrl(img.filename, img.subfolder ?? '', img.type ?? 'output')} alt="result" className="w-full rounded border border-border" />
              ))}
            </div>
          )
        })()}

        {/* Error */}
        {stage.status === 'error' && (
          <div className="space-y-3">
            <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
              {stage.message}
            </p>
            <Button variant="ghost" size="sm" onClick={resetFull}>Reset</Button>
          </div>
        )}

        {/* Farm status */}
        {farmStage.status !== 'idle' && (
          <>
            {(stage.status !== 'idle' || farmStage.status !== 'idle') && <Separator />}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Farm Job</p>

              {farmStage.status === 'submitting' && (
                <p className="text-xs text-muted-foreground">Submitting to Deadline…</p>
              )}

              {(farmStage.status === 'queued' || farmStage.status === 'rendering') && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className={cn(
                      farmStage.status === 'rendering' && 'text-primary'
                    )}>
                      {farmStage.status === 'queued' ? 'Queued on farm' : 'Rendering on farm'}
                    </span>
                    <span>{Math.round(farmStage.progress)}%</span>
                  </div>
                  <Progress value={farmStage.progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    Job ID: {farmStage.deadlineJobId}
                  </p>
                </div>
              )}

              {farmStage.status === 'complete' && (
                <div className="space-y-2">
                  <p className="text-xs text-green-500">
                    Complete — outputs saved to NAS
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Job ID: {farmStage.deadlineJobId}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setFarmStage({ status: 'idle' })}>
                    Dismiss
                  </Button>
                </div>
              )}

              {farmStage.status === 'failed' && (
                <div className="space-y-2">
                  <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
                    {farmStage.message}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setFarmStage({ status: 'idle' })}>
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
