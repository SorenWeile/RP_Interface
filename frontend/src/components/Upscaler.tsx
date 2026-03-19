import { useCallback, useRef, useState } from 'react'
import {
  connectProgress,
  imageUrl,
  runUpscale,
  uploadImage,
  type ProgressEvent,
} from '../api/client'

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
          // Poll for result
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

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="mb-6">
        <h1 className="text-comfy-fg text-lg font-medium tracking-wide">Image Upscaler</h1>
        <p className="text-comfy-muted text-xs mt-1">
          Drop an image, pick a scale factor, hit upscale.
        </p>
      </div>

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
            ? 'border-comfy-accent bg-comfy-canvas'
            : 'border-comfy-border bg-comfy-panel hover:border-comfy-accent/60',
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
            <div className="text-comfy-muted text-3xl mb-3">↓</div>
            <p className="text-comfy-muted text-sm">Drop image here or click to browse</p>
          </div>
        )}

        {stage.status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/70 rounded">
            <span className="text-comfy-muted text-xs tracking-widest animate-pulse">
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
      <div className="flex items-center gap-4">
        {/* Upscale button */}
        <button
          onClick={startUpscale}
          disabled={!filename || stage.status === 'processing' || stage.status === 'uploading' || stage.status === 'queued'}
          className={[
            'flex-1 py-2 rounded text-sm font-medium tracking-wide transition-colors',
            filename && stage.status === 'idle'
              ? 'bg-comfy-accent text-comfy-bg hover:bg-comfy-accent/80'
              : 'bg-comfy-panel text-comfy-muted cursor-not-allowed',
          ].join(' ')}
        >
          {stage.status === 'queued' ? 'Queued…'
            : stage.status === 'uploading' ? 'Uploading…'
            : 'Upscale'}
        </button>

        {(stage.status !== 'idle' || preview) && (
          <button
            onClick={reset}
            className="px-3 py-2 rounded text-xs text-comfy-muted border border-comfy-border hover:border-comfy-fg hover:text-comfy-fg transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Progress bar */}
      {stage.status === 'processing' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-comfy-muted">
            <span>Processing</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1 bg-comfy-panel rounded overflow-hidden">
            <div
              className="h-full bg-comfy-accent transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {stage.status === 'error' && (
        <p className="text-comfy-error text-xs border border-comfy-error/30 rounded px-3 py-2 bg-comfy-panel">
          {stage.message}
        </p>
      )}

      {/* Result */}
      {stage.status === 'done' && stage.images.length > 0 && (
        <div className="space-y-3">
          <p className="text-comfy-muted text-xs tracking-widest uppercase">Result</p>
          {stage.images.map((img) => {
            const url = imageUrl(img.filename, img.subfolder, img.type)
            return (
              <div key={img.filename} className="space-y-2">
                <img
                  src={url}
                  alt="upscaled result"
                  className="w-full rounded border border-comfy-border"
                />
                <a
                  href={url}
                  download={img.filename}
                  className="inline-block text-xs px-3 py-1.5 border border-comfy-border rounded text-comfy-muted hover:text-comfy-fg hover:border-comfy-fg transition-colors"
                >
                  Download {img.filename}
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
