import { useCallback, useRef, useState } from 'react'
import {
  connectProgress,
  imageUrl,
  runUpscale,
  uploadImage,
  type ProgressEvent,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

type Stage =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'queued' }
  | { status: 'processing'; value: number; max: number }
  | { status: 'done'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

export default function Upscaler() {
  const [stage, setStage]       = useState<Stage>({ status: 'idle' })
  const [preview, setPreview]   = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput               = useRef<HTMLInputElement>(null)
  const disconnectWs            = useRef<(() => void) | null>(null)

  const handleFile = useCallback((file: File) => {
    setPreview(URL.createObjectURL(file))
    setFilename(null)
    setStage({ status: 'uploading' })

    uploadImage(file)
      .then((r) => {
        setFilename(r.filename)
        setStage({ status: 'idle' })
      })
      .catch((e) => setStage({ status: 'error', message: String(e) }))
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const startUpscale = async () => {
    if (!filename) return
    try {
      setStage({ status: 'queued' })
      const { prompt_id, client_id } = await runUpscale(filename)

      setStage({ status: 'processing', value: 0, max: 1 })

      disconnectWs.current?.()
      disconnectWs.current = connectProgress(client_id, prompt_id, (event: ProgressEvent) => {
        if (event.type === 'progress') {
          setStage({ status: 'processing', value: event.value, max: event.max })
        } else if (event.type === 'complete') {
          const poll = setInterval(async () => {
            try {
              const s = await (await fetch(`/api/status/${prompt_id}`)).json()
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'done', images: s.images ?? [] })
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
              }
            } catch {
              clearInterval(poll)
              setStage({ status: 'error', message: 'Status poll failed' })
            }
          }, 800)
        } else if (event.type === 'error') {
          setStage({ status: 'error', message: event.message ?? 'Unknown error' })
        }
      })
    } catch (e) {
      setStage({ status: 'error', message: String(e) })
    }
  }

  const reset = () => {
    disconnectWs.current?.()
    setStage({ status: 'idle' })
    setPreview(null)
    setFilename(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const progressPct =
    stage.status === 'processing' && stage.max > 0
      ? Math.round((stage.value / stage.max) * 100)
      : 0

  const busy = stage.status === 'processing' || stage.status === 'uploading' || stage.status === 'queued'

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={[
          'relative border-2 border-dashed rounded transition-colors cursor-pointer',
          'flex flex-col items-center justify-center min-h-52 select-none',
          dragging
            ? 'border-primary bg-comfy-canvas'
            : 'border-comfy-border bg-comfy-panel hover:border-primary/60',
        ].join(' ')}
      >
        {preview ? (
          <img
            src={preview}
            alt="preview"
            className="max-h-64 max-w-full object-contain rounded opacity-80"
          />
        ) : (
          <div className="text-center p-8">
            <div className="text-muted-foreground text-3xl mb-3">↓</div>
            <p className="text-muted-foreground text-sm">Drop image here or click to browse</p>
          </div>
        )}

        {stage.status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/70 rounded">
            <span className="text-muted-foreground text-xs tracking-widest animate-pulse">
              UPLOADING…
            </span>
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          className="flex-1"
          onClick={startUpscale}
          disabled={!filename || busy}
        >
          {stage.status === 'queued' ? 'Queued…'
            : stage.status === 'uploading' ? 'Uploading…'
            : stage.status === 'processing' ? `Processing ${progressPct}%`
            : 'Upscale'}
        </Button>

        {(stage.status !== 'idle' || preview) && (
          <Button variant="outline" size="sm" onClick={reset}>
            Reset
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {stage.status === 'processing' && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Processing</span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1" />
        </div>
      )}

      {/* Error */}
      {stage.status === 'error' && (
        <p className="text-destructive text-xs border border-destructive/30 rounded px-3 py-2 bg-comfy-panel">
          {stage.message}
        </p>
      )}

      {/* Result */}
      {stage.status === 'done' && stage.images.length > 0 && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs tracking-widest uppercase">Result</p>
          {stage.images.map((img) => {
            const url = imageUrl(img.filename, img.subfolder, img.type)
            return (
              <div key={img.filename} className="space-y-2">
                <img
                  src={url}
                  alt="upscaled result"
                  className="w-full rounded border border-comfy-border"
                />
                <Button variant="outline" size="sm" asChild>
                  <a href={url} download={img.filename}>
                    Download {img.filename}
                  </a>
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
