import { useRef, useState } from 'react'
import { runPanorama, connectProgress, type ProgressEvent, imageUrl } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import PanoramaEditor, { type PanoramaEditorHandle } from './PanoramaEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage =
  | { status: 'idle' | 'submitting' }
  | { status: 'running'; promptId: string; clientId: string; progress: number; max: number }
  | { status: 'complete'; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { status: 'error'; message: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function Panorama() {
  const editorRef                         = useRef<PanoramaEditorHandle>(null)
  const wsCleanupRef                      = useRef<(() => void) | null>(null)
  const [hasSticker, setHasSticker]       = useState(false)
  const [prompt, setPrompt]               = useState(
    'Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.'
  )
  const [filePrefix, setFilePrefix]       = useState('')
  const [stage, setStage]                 = useState<Stage>({ status: 'idle' })

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!editorRef.current) return
    const state_json = editorRef.current.getStateJson()
    setStage({ status: 'submitting' })
    try {
      const { prompt_id, client_id } = await runPanorama({
        state_json,
        prompt,
        filename_prefix: filePrefix || 'ComfyUI',
      })
      setStage({ status: 'running', promptId: prompt_id, clientId: client_id, progress: 0, max: 1 })

      wsCleanupRef.current = connectProgress(client_id, prompt_id, (ev: ProgressEvent) => {
        if (ev.type === 'progress') {
          setStage((prev) =>
            prev.status === 'running' ? { ...prev, progress: ev.value, max: ev.max } : prev,
          )
        } else if (ev.type === 'complete') {
          wsCleanupRef.current?.()
          const poll = setInterval(async () => {
            try {
              const res = await fetch(`/api/status/${prompt_id}`)
              const s = await res.json()
              if (s.status === 'done') {
                clearInterval(poll)
                setStage({ status: 'complete', images: s.images ?? [] })
                // Feed the full ERP panorama back into the editor.
                // The ERP image has a filename ending in "_erp" (node 67 prefix).
                const imgs = s.images ?? []
                const erp = imgs.find((i: { filename: string; subfolder: string; type: string }) => i.filename.includes('_erp')) ?? imgs[0]
                if (erp) {
                  editorRef.current?.setErpPreview(
                    imageUrl(erp.filename, erp.subfolder, erp.type)
                  )
                }
              } else if (s.status === 'error') {
                clearInterval(poll)
                setStage({ status: 'error', message: 'Workflow error' })
              }
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

  const reset = () => {
    wsCleanupRef.current?.()
    wsCleanupRef.current = null
    setStage({ status: 'idle' })
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isBusy    = stage.status === 'submitting' || stage.status === 'running'
  const canSubmit = hasSticker && !isBusy
  const pct       = stage.status === 'running' && stage.max > 0
    ? Math.round((stage.progress / stage.max) * 100)
    : 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Interactive 360° sticker editor */}
      <PanoramaEditor ref={editorRef} onHasSticker={setHasSticker} />

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
        />
      </div>

      <Separator />

      {/* Filename prefix */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Filename Prefix</label>
        <Input
          placeholder="ComfyUI"
          value={filePrefix}
          onChange={(e) => setFilePrefix(e.target.value)}
          disabled={isBusy}
        />
      </div>

      {/* Submit */}
      {(stage.status === 'idle' || stage.status === 'submitting') && (
        <div className="flex items-center gap-3 pt-1">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {stage.status === 'submitting' ? 'Queuing…' : 'Generate Panorama'}
          </Button>
          {stage.status === 'idle' && !hasSticker && (
            <p className="text-xs text-muted-foreground">Add a sticker to get started</p>
          )}
        </div>
      )}

      {/* Progress */}
      {stage.status === 'running' && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="animate-pulse">Generating panorama…</span>
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
            <span className="normal-case ml-1">(result shown in editor above)</span>
          </p>
          {stage.images.map((img, i) => {
            const url = imageUrl(img.filename, img.subfolder, img.type)
            return (
              <div key={i} className="space-y-2">
                <img src={url} alt={img.filename} className="rounded border border-border max-w-full" />
                <Button variant="outline" size="sm" asChild>
                  <a href={url} download={img.filename}>Download {img.filename}</a>
                </Button>
              </div>
            )
          })}
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
