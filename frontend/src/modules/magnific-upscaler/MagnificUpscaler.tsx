import { useCallback, useRef, useState } from 'react'
import { runMagnificUpscaler, uploadImage, getStatus, connectProgress, imageUrl, type ProgressEvent } from '@/api/client'
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
const SCALE_OPTIONS = ['2x', '4x', '8x', '16x'] as const
type ScaleFactor = typeof SCALE_OPTIONS[number]

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'processing'; pct: number }
  | { status: 'done'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

// ── Int input ─────────────────────────────────────────────────────────────────

function IntInput({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max = 100,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  min?: number
  max?: number
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <span className="text-xs font-medium text-foreground w-8 text-right">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MagnificUpscaler() {
  const [slot, setSlot]               = useState<ImageSlot>(EMPTY_SLOT)
  const [sharpen, setSharpen]         = useState(7)
  const [smartGrain, setSmartGrain]   = useState(7)
  const [ultraDetail, setUltraDetail] = useState(30)
  const [scaleFactor, setScaleFactor] = useState<ScaleFactor>('4x')
  const [clientPath, setClientPath]   = useState('')
  const [productPath, setProductPath] = useState('')
  const [filePrefix, setFilePrefix]   = useState('Shot001')
  const [stage, setStage]             = useState<Stage>({ status: 'idle' })
  const disconnectWs                  = useRef<(() => void) | null>(null)
  const { toast }                     = useToast()

  // ── Upload ───────────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const preview = URL.createObjectURL(file)
    setSlot({ preview, filename: null, state: 'uploading' })
    try {
      const { filename } = await uploadImage(file)
      setSlot({ preview, filename, state: 'ready' })
    } catch {
      setSlot({ preview, filename: null, state: 'error' })
    }
  }, [])

  const clearSlot = () => setSlot(EMPTY_SLOT)

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!slot.filename) return
    setStage({ status: 'submitting' })

    try {
      const { prompt_id, client_id } = await runMagnificUpscaler({
        filename: slot.filename,
        sharpen,
        smart_grain: smartGrain,
        ultra_detail: ultraDetail,
        scale_factor: scaleFactor,
        client_path: clientPath,
        product_path: productPath,
        filename_prefix: filePrefix,
      })

      setStage({ status: 'processing', pct: 0 })

      disconnectWs.current?.()
      disconnectWs.current = connectProgress(client_id, prompt_id, (event: ProgressEvent) => {
        if (event.type === 'progress') {
          const pct = event.max > 0 ? Math.round((event.value / event.max) * 100) : 0
          setStage({ status: 'processing', pct })
        } else if (event.type === 'complete') {
          // Poll until history is populated
          const poll = setInterval(async () => {
            try {
              const s = await getStatus(prompt_id)
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'done', images: s.images ?? [] })
                toast('Upscale complete!', 'success')
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
                toast('Upscale failed', 'error')
              }
            } catch {
              clearInterval(poll)
              setStage({ status: 'error', message: 'Status poll failed' })
              toast('Status poll failed', 'error')
            }
          }, 800)
        } else if (event.type === 'error') {
          setStage({ status: 'error', message: event.message ?? 'Unknown error' })
          toast('Upscale error', 'error')
        }
      })
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
      toast('Failed to start upscale', 'error')
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    disconnectWs.current?.()
    disconnectWs.current = null
    setStage({ status: 'idle' })
  }

  const resetFull = () => {
    reset()
    setSlot(EMPTY_SLOT)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isBusy    = stage.status === 'submitting' || stage.status === 'processing'
  const canSubmit = slot.state === 'ready' && !isBusy

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
          onClear={clearSlot}
        />
      </div>

      <Separator />

      {/* Magnific parameters */}
      <div className="space-y-4">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Upscale Settings</label>

        {/* Scale factor */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Scale Factor</label>
          <div className="flex gap-2">
            {SCALE_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setScaleFactor(opt)}
                disabled={isBusy}
                className={cn(
                  'flex-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  scaleFactor === opt
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border bg-background hover:bg-accent text-foreground',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Int sliders */}
        <IntInput
          label="Sharpen"
          value={sharpen}
          onChange={setSharpen}
          disabled={isBusy}
        />
        <IntInput
          label="Smart Grain"
          value={smartGrain}
          onChange={setSmartGrain}
          disabled={isBusy}
        />
        <IntInput
          label="Ultra Detail"
          value={ultraDetail}
          onChange={setUltraDetail}
          disabled={isBusy}
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
            {stage.status === 'submitting' ? 'Queuing…' : `Upscale ${scaleFactor}`}
          </Button>
          {slot.preview && (
            <Button variant="ghost" size="sm" onClick={resetFull}>Reset</Button>
          )}
        </div>
      )}

      {/* Progress */}
      {stage.status === 'processing' && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Processing…</span>
            <span>{stage.pct}%</span>
          </div>
          <Progress value={stage.pct} className="h-1.5" />
        </div>
      )}

      {/* Done */}
      {stage.status === 'done' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            {stage.images.map((img, i) => (
              <Button key={i} variant="outline" size="sm" onClick={() => { toast('Downloading…', 'info'); fetchAndDownload(imageUrl(img.filename, img.subfolder, img.type), img.filename) }}>
                Download {img.filename}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={reset}>New run</Button>
            <Button variant="ghost" size="sm" onClick={resetFull}>Reset all</Button>
          </div>
          {stage.images.map((img) => (
            <img
              key={img.filename}
              src={imageUrl(img.filename, img.subfolder, img.type)}
              alt="upscaled result"
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
          <Button variant="ghost" size="sm" onClick={resetFull}>Reset</Button>
        </div>
      )}
    </div>
  )
}
