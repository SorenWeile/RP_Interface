import { useCallback, useRef, useState } from 'react'
import { uploadImage, runOutfitSwapping, getStatus, connectProgress, type ProgressEvent, imageUrl } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadState = 'empty' | 'uploading' | 'ready' | 'error'

interface ImageSlot {
  preview: string | null
  filename: string | null
  state: UploadState
}

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }

const REF_COUNT = 7

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'running'; promptId: string; clientId: string; progress: number; max: number }
  | { status: 'complete'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

// ── Drop zone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  slot: ImageSlot
  label: string
  disabled?: boolean
  onFile: (file: File) => void
  size?: 'lg' | 'sm'
}

function DropZone({ slot, label, disabled, onFile, size = 'lg' }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && !disabled) onFile(file)
  }

  return (
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
        <img
          src={slot.preview}
          alt={label}
          className={cn(
            'object-contain rounded opacity-80',
            size === 'lg' ? 'max-h-48 max-w-full' : 'max-h-16 max-w-full',
          )}
        />
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
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) onFile(file)
        e.target.value = ''
      }} />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutfitSwapping() {
  const [mainSlot, setMainSlot]     = useState<ImageSlot>(EMPTY_SLOT)
  const [refSlots, setRefSlots]     = useState<ImageSlot[]>(Array(REF_COUNT).fill(EMPTY_SLOT))
  const [prompt, setPrompt]         = useState('add rider to the Bike, he is wearing a race suit, outfit, helmet, boots and gloves.')
  const [clientPath, setClientPath] = useState('Deployed/HD')
  const [productPath, setProductPath] = useState('')
  const [filePrefix, setFilePrefix] = useState('')
  const [stage, setStage]           = useState<Stage>({ status: 'idle' })
  const wsCleanupRef                = useRef<(() => void) | null>(null)

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

      wsCleanupRef.current = connectProgress(client_id, prompt_id, async (ev: ProgressEvent) => {
        if (ev.type === 'progress') {
          setStage((prev) =>
            prev.status === 'running'
              ? { ...prev, progress: ev.value, max: ev.max }
              : prev,
          )
        } else if (ev.type === 'complete') {
          wsCleanupRef.current?.()
          // Fetch output images from history
          try {
            const s = await getStatus(prompt_id)
            setStage({ status: 'complete', images: s.images ?? [] })
          } catch {
            setStage({ status: 'complete', images: [] })
          }
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
          rows={3}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">Client Path</label>
          <Input
            placeholder="Deployed/HD"
            value={clientPath}
            onChange={(e) => setClientPath(e.target.value)}
            disabled={isBusy}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">Product Path</label>
          <Input
            placeholder="ProjectName"
            value={productPath}
            onChange={(e) => setProductPath(e.target.value)}
            disabled={isBusy}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">Filename Prefix</label>
          <Input
            placeholder="Shot001"
            value={filePrefix}
            onChange={(e) => setFilePrefix(e.target.value)}
            disabled={isBusy}
          />
        </div>
      </div>

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
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="animate-pulse">Processing…</span>
              <span>{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        </div>
      )}

      {/* Complete */}
      {stage.status === 'complete' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Done — {stage.images.length} image{stage.images.length !== 1 ? 's' : ''}
          </p>
          {stage.images.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {stage.images.map((img, i) => (
                <img
                  key={i}
                  src={imageUrl(img.filename, img.subfolder, img.type)}
                  alt={img.filename}
                  className="rounded border border-border max-w-full"
                />
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={reset}>New run</Button>
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
