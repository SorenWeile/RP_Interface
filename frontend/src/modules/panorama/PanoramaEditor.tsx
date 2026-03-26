import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmbeddedEditorInstance {
  root: HTMLElement
  getState(): Record<string, unknown>
  setState(state: Record<string, unknown>): void
  setErpPreview(src: string): void
  requestDraw(): void
  destroy(): void
}

interface PanoramaEditorModule {
  createEmbeddedEditor(
    host: HTMLElement,
    config: {
      type: 'stickers' | 'cutout'
      onStateChange?: (state: Record<string, unknown>, meta: { source: string }) => void
      adapters?: {
        saveAssetFile?: (file: File, ctx: unknown) => Promise<Record<string, unknown>>
        loadAssetPreviewSrc?: (asset: Record<string, unknown>) => string | null
      }
    },
  ): EmbeddedEditorInstance
}

export interface PanoramaEditorHandle {
  /** Returns the full editor state as a JSON string, ready for the backend. */
  getStateJson(): string
  /** Feed back the generated ERP image so the editor shows the result. */
  setErpPreview(url: string): void
}

interface Props {
  onHasSticker: (has: boolean) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

const PanoramaEditor = forwardRef<PanoramaEditorHandle, Props>(function PanoramaEditor(
  { onHasSticker },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EmbeddedEditorInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let destroyed = false

    async function mount() {
      if (!hostRef.current) return
      try {
        // Dynamic import keeps the 4 MB bundle out of Vite's main chunk.
        // The CSS file lives alongside the JS and self-installs via import.meta.url.
        const mod = await (import(/* @vite-ignore */ '/pano/pano_editor_demo_core.js') as Promise<PanoramaEditorModule>)
        if (destroyed || !hostRef.current) return

        const editor = mod.createEmbeddedEditor(hostRef.current, {
          type: 'stickers',

          onStateChange(state) {
            const stickers = state?.stickers
            onHasSticker(Array.isArray(stickers) && stickers.length > 0)
          },

          adapters: {
            // Upload sticker images to ComfyUI via our backend proxy.
            async saveAssetFile(file) {
              const form = new FormData()
              form.append('file', file)
              const res = await fetch('/api/upload', { method: 'POST', body: form })
              if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
              const { filename } = await res.json() as { filename: string }
              return {
                type: 'comfy_image',
                filename,
                subfolder: '',
                storage: 'input',
                name: file.name,
              }
            },

            // Resolve comfy_image assets to display URLs via our image proxy.
            loadAssetPreviewSrc(asset) {
              if (asset?.type === 'comfy_image') {
                const p = new URLSearchParams({
                  filename: String(asset.filename ?? ''),
                  subfolder: String(asset.subfolder ?? ''),
                  type: String(asset.storage ?? 'input'),
                })
                return `/api/image?${p.toString()}`
              }
              return null
            },
          },
        })

        editorRef.current = editor
        setLoading(false)
      } catch (err) {
        if (!destroyed) setError(String(err))
      }
    }

    mount()

    return () => {
      destroyed = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [onHasSticker])

  useImperativeHandle(ref, () => ({
    getStateJson() {
      const state = editorRef.current?.getState() ?? {}
      return JSON.stringify(state)
    },
    setErpPreview(url: string) {
      editorRef.current?.setErpPreview(url)
    },
  }))

  return (
    <div className="relative w-full" style={{ minHeight: 480 }}>
      {/* Mount point — the editor renders directly into this div */}
      <div ref={hostRef} className="w-full h-full" style={{ minHeight: 480 }} />

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/80 rounded">
          <span className="text-muted-foreground text-xs tracking-widest animate-pulse">
            LOADING EDITOR…
          </span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-comfy-bg/90 rounded p-4">
          <p className="text-destructive text-xs text-center">
            Failed to load panorama editor: {error}
          </p>
        </div>
      )}
    </div>
  )
})

export default PanoramaEditor
