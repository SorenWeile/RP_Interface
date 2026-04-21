import { useCallback, useRef, useState } from 'react'
import { runVideoCreation, uploadImage, getStatus, connectProgress, videoUrl, type ProgressEvent } from '@/api/client'
import { fetchAndDownload } from '@/lib/download'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/Toaster'
import ClientProjectPicker from '@/components/ClientProjectPicker'
import DropZone, { type ImageSlot } from '@/components/DropZone'

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }
const FRAME_RATE = 25
const MIN_LENGTH = 25
const MAX_LENGTH = 125
const DEFAULT_LENGTH = 121

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoFile {
  filename: string
  subfolder: string
  type: string
  format?: string
}

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'processing'; pct: number }
  | { status: 'done'; videos: VideoFile[] }
  | { status: 'error'; message: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function VideoCreation() {
  const [firstFrame, setFirstFrame]   = useState<ImageSlot>(EMPTY_SLOT)
  const [lastFrame, setLastFrame]     = useState<ImageSlot>(EMPTY_SLOT)
  const [prompt, setPrompt]           = useState('')
  const [length, setLength]           = useState(DEFAULT_LENGTH)
  const [clientPath, setClientPath]   = useState('')
  const [productPath, setProductPath] = useState('')
  const [filePrefix, setFilePrefix]   = useState('Video001')
  const [stage, setStage]             = useState<Stage>({ status: 'idle' })
  const disconnectWs                  = useRef<(() => void) | null>(null)
  const { toast }                     = useToast()

  const seconds = (length / FRAME_RATE).toFixed(1)

  // ── Upload ───────────────────────────────────────────────────────────────────

  const uploadSlot = useCallback(
    async (file: File, setter: React.Dispatch<React.SetStateAction<ImageSlot>>) => {
      const preview = URL.createObjectURL(file)
      setter({ preview, filename: null, state: 'uploading' })
      try {
        const { filename } = await uploadImage(file)
        setter({ preview, filename, state: 'ready' })
      } catch {
        setter({ preview, filename: null, state: 'error' })
      }
    },
    [],
  )

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!firstFrame.filename || !lastFrame.filename) return
    setStage({ status: 'submitting' })

    try {
      const { prompt_id, client_id } = await runVideoCreation({
        first_frame: firstFrame.filename,
        last_frame: lastFrame.filename,
        prompt,
        length,
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
          const poll = setInterval(async () => {
            try {
              const s = await getStatus(prompt_id)
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'done', videos: s.videos ?? [] })
                toast('Video generation complete!', 'success')
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
                toast('Video generation failed', 'error')
              }
            } catch {
              clearInterval(poll)
              setStage({ status: 'error', message: 'Status poll failed' })
              toast('Status poll failed', 'error')
            }
          }, 800)
        } else if (event.type === 'error') {
          setStage({ status: 'error', message: event.message ?? 'Unknown error' })
          toast('Video generation error', 'error')
        }
      })
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
      toast('Failed to start video generation', 'error')
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
    setFirstFrame(EMPTY_SLOT)
    setLastFrame(EMPTY_SLOT)
    setPrompt('')
    setLength(DEFAULT_LENGTH)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isBusy    = stage.status === 'submitting' || stage.status === 'processing'
  const canSubmit = firstFrame.state === 'ready' && lastFrame.state === 'ready' && !isBusy

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Frame inputs */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Frame Inputs</label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">First Frame</p>
            <DropZone
              slot={firstFrame}
              label="First Frame"
              disabled={isBusy}
              onFile={(f) => uploadSlot(f, setFirstFrame)}
              onClear={() => setFirstFrame(EMPTY_SLOT)}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Last Frame</p>
            <DropZone
              slot={lastFrame}
              label="Last Frame"
              disabled={isBusy}
              onFile={(f) => uploadSlot(f, setLastFrame)}
              onClear={() => setLastFrame(EMPTY_SLOT)}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Prompt Instruction</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isBusy}
          rows={8}
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'resize-y disabled:opacity-60',
          )}
          placeholder='Describe the video motion, e.g. "Camera slowly pans right revealing the motorcycle against a desert sunset..."'
        />
      </div>

      <Separator />

      {/* Length slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">Video Length</label>
          <div className="text-right">
            <span className="text-sm font-medium text-foreground">{length} frames</span>
            <span className="text-xs text-muted-foreground ml-2">({seconds}s @ {FRAME_RATE} fps)</span>
          </div>
        </div>
        <input
          type="range"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          step={1}
          value={length}
          disabled={isBusy}
          onChange={e => setLength(Number(e.target.value))}
          className="w-full accent-primary disabled:opacity-50"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{MIN_LENGTH} frames ({(MIN_LENGTH / FRAME_RATE).toFixed(1)}s)</span>
          <span>{MAX_LENGTH} frames ({(MAX_LENGTH / FRAME_RATE).toFixed(1)}s)</span>
        </div>
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
            {stage.status === 'submitting' ? 'Queuing…' : `Generate Video — ${seconds}s`}
          </Button>
          {(firstFrame.preview || lastFrame.preview) && (
            <Button variant="ghost" size="sm" onClick={resetFull}>Reset</Button>
          )}
        </div>
      )}

      {/* Progress */}
      {stage.status === 'processing' && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Generating video…</span>
            <span>{stage.pct}%</span>
          </div>
          <Progress value={stage.pct} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            Video generation takes several minutes. Please keep this tab open.
          </p>
        </div>
      )}

      {/* Done */}
      {stage.status === 'done' && (
        <div className="space-y-4">
          {stage.videos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Generation complete. Video saved to output path.</p>
          ) : (
            stage.videos.map((vid, i) => {
              const url = videoUrl(vid.filename, vid.subfolder, vid.type)
              return (
                <div key={i} className="space-y-2">
                  <video
                    src={url}
                    controls
                    className="w-full rounded border border-border"
                  />
                  <Button variant="outline" size="sm" onClick={() => { toast('Downloading…', 'info'); fetchAndDownload(url, vid.filename) }}>
                    Download {vid.filename}
                  </Button>
                </div>
              )
            })
          )}
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={reset}>New run</Button>
            <Button variant="ghost" size="sm" onClick={resetFull}>Reset all</Button>
          </div>
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
