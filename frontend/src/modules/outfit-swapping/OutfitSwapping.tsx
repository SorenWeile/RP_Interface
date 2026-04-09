import { useCallback, useRef, useState } from 'react'
import { uploadImage, runOutfitSwapping, connectProgress, type ProgressEvent, imageUrl } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import ClientProjectPicker from '@/components/ClientProjectPicker'
import DropZone, { type ImageSlot, type UploadState } from '@/components/DropZone'

// ── Types ─────────────────────────────────────────────────────────────────────

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }
const REF_COUNT = 7

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'running'; promptId: string; clientId: string; progress: number; max: number }
  | { status: 'complete'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutfitSwapping() {
  const [mainSlot, setMainSlot]         = useState<ImageSlot>(EMPTY_SLOT)
  const [refSlots, setRefSlots]         = useState<ImageSlot[]>(Array(REF_COUNT).fill(EMPTY_SLOT))
  const [prompt, setPrompt]             = useState('add rider to the Bike, he is wearing a race suit, outfit, helmet, boots and gloves.')
  const [clientPath, setClientPath]     = useState('')
  const [productPath, setProductPath]   = useState('')
  const [filePrefix, setFilePrefix]     = useState('Shot001')
  const [stage, setStage]               = useState<Stage>({ status: 'idle' })
  const wsCleanupRef                    = useRef<(() => void) | null>(null)

  // ── Upload helpers ───────────────────────────────────────────────────────────

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

  const handleMainFile = useCallback(
    (file: File) => uploadSlot(file, setMainSlot),
    [uploadSlot],
  )

  const handleRefFile = useCallback(
    (index: number, file: File) =>
      uploadSlot(file, (fn) =>
        setRefSlots((prev) => prev.map((s, i) => (i === index ? fn(s) : s))),
      ),
    [uploadSlot],
  )

  const clearMain = () => setMainSlot(EMPTY_SLOT)
  const clearRef  = (index: number) =>
    setRefSlots((prev) => prev.map((s, i) => (i === index ? EMPTY_SLOT : s)))

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!mainSlot.filename) return
    setStage({ status: 'submitting' })

    const readyRefs = refSlots
      .filter((s) => s.state === 'ready' && s.filename)
      .map((s) => s.filename!)

    try {
      const { prompt_id, client_id } = await runOutfitSwapping({
        main_image: mainSlot.filename,
        ref_images: readyRefs,
        prompt,
        client_path: clientPath,
        product_path: productPath,
        filename_prefix: filePrefix,
      })

      setStage({ status: 'running', promptId: prompt_id, clientId: client_id, progress: 0, max: 1 })

      wsCleanupRef.current = connectProgress(client_id, prompt_id, (ev: ProgressEvent) => {
        if (ev.type === 'progress') {
          setStage((prev) =>
            prev.status === 'running'
              ? { ...prev, progress: ev.value, max: ev.max }
              : prev,
          )
        } else if (ev.type === 'complete') {
          wsCleanupRef.current?.()
          // Poll until history is populated — same pattern as Upscaler
          const poll = setInterval(async () => {
            try {
              const res = await fetch(`/api/status/${prompt_id}`)
              const s = await res.json()
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'complete', images: s.images ?? [] })
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
              }
              // 'pending' / 'processing' → keep polling
            } catch {
              clearInterval(poll)
              setStage({ status: 'error', message: 'Status poll failed' })
            }
          }, 800)
        } else if (ev.type === 'error') {
          wsCleanupRef.current?.()
          setStage({ status: 'error', message: JSON.stringify(ev.data ?? ev.message) })
        }
      })
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    wsCleanupRef.current?.()
    wsCleanupRef.current = null
    setMainSlot(EMPTY_SLOT)
    setRefSlots(Array(REF_COUNT).fill(EMPTY_SLOT))
    setStage({ status: 'idle' })
  }

  const newRun = () => {
    wsCleanupRef.current?.()
    wsCleanupRef.current = null
    setStage({ status: 'idle' })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isBusy    = stage.status === 'submitting' || stage.status === 'running'
  const canSubmit = mainSlot.state === 'ready' && !isBusy
  const pct       = stage.status === 'running' && stage.max > 0
    ? Math.round((stage.progress / stage.max) * 100)
    : 0

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Main image */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Main Image</label>
        <DropZone
          slot={mainSlot}
          label="Drop subject image here or click to browse"
          disabled={isBusy}
          onFile={handleMainFile}
          onClear={clearMain}
          size="lg"
        />
      </div>

      <Separator />

      {/* Reference images */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground uppercase tracking-widest">
          Reference Images <span className="normal-case">(outfit items — up to 7)</span>
        </span>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {refSlots.map((slot, i) => (
            <DropZone
              key={i}
              slot={slot}
              label={`Ref ${i + 1}`}
              disabled={isBusy}
              onFile={(f) => handleRefFile(i, f)}
              onClear={() => clearRef(i)}
              size="sm"
            />
          ))}
        </div>
      </div>

      <Separator />

      {/* Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Prompt</label>
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
          placeholder="Describe what to generate…"
        />
      </div>

      <Separator />

      {/* Output path fields */}
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
            {stage.status === 'submitting' ? 'Queuing…' : 'Generate'}
          </Button>
          {(mainSlot.preview || refSlots.some((s) => s.preview)) && (
            <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
          )}
        </div>
      )}

      {/* Progress */}
      {stage.status === 'running' && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="animate-pulse">Processing…</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
      )}

      {/* Complete */}
      {stage.status === 'complete' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Done — {stage.images.length} image{stage.images.length !== 1 ? 's' : ''}
          </p>
          {stage.images.length > 0 && (
            <div className="space-y-3">
              {stage.images.map((img, i) => {
                const url = imageUrl(img.filename, img.subfolder, img.type)
                return (
                  <div key={i} className="space-y-2">
                    <img
                      src={url}
                      alt={img.filename}
                      className="rounded border border-border max-w-full"
                    />
                    <Button variant="outline" size="sm" asChild>
                      <a href={url} download={img.filename}>Download {img.filename}</a>
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={newRun}>New run</Button>
        </div>
      )}

      {/* Error */}
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
