import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GalleryImage, ImageMetadata, WorkflowNode } from './types'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title={label}
    >
      <Copy className="w-3 h-3" />
      {copied && <span className="sr-only">Copied!</span>}
    </button>
  )
}

function Section({
  title,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title: string
  storageKey: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(`gallery-section-${storageKey}`)
      return stored !== null ? stored === 'true' : defaultOpen
    } catch {
      return defaultOpen
    }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(`gallery-section-${storageKey}`, String(next))
    } catch {}
  }

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

function NodeCard({ node }: { node: WorkflowNode }) {
  const params = Object.entries(node.params)
  return (
    <div className="rounded border border-border bg-background/50 p-2 mb-2 last:mb-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs bg-primary/20 text-primary rounded px-1.5 py-0.5 font-mono">
          {node.id}
        </span>
        <span className="text-xs font-medium truncate">{node.title || node.type}</span>
      </div>
      {params.length > 0 && (
        <div className="space-y-0.5">
          {params.map(([k, v]) => {
            const str = typeof v === 'string' ? v : JSON.stringify(v)
            return (
              <div key={k} className="flex items-start gap-1.5 text-xs">
                <span className="text-muted-foreground shrink-0 min-w-[60px]">{k}</span>
                <span className="text-foreground break-all flex-1 font-mono text-[11px]">
                  {str.length > 120 ? str.slice(0, 120) + '…' : str}
                </span>
                <CopyButton text={str} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Props {
  image: GalleryImage | null
  metadata: ImageMetadata | null
  loading: boolean
  onToggleFavorite: (img: GalleryImage) => void
}

export default function MetadataPanel({ image, metadata, loading, onToggleFavorite }: Props) {
  return (
    <aside className="w-[340px] shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest flex-1">
          Metadata
        </p>
        {image && (
          <button
            onClick={() => onToggleFavorite(image)}
            className={cn(
              'transition-colors',
              image.is_favorite ? 'text-yellow-400' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Toggle favourite"
          >
            <Star className="w-4 h-4" fill={image.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {!image && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          Select an image
        </div>
      )}

      {image && loading && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      )}

      {image && !loading && (
        <div className="flex-1 overflow-y-auto">
          {/* Basic info */}
          <Section title="Basic Info" storageKey="basic" defaultOpen>
            <div className="space-y-1 text-xs">
              {([
                ['Name', image.name],
                ['Format', metadata?.format ?? '—'],
                ['Dimensions', metadata ? `${metadata.size.width} × ${metadata.size.height}` : '—'],
                ['Mode', metadata?.mode ?? '—'],
                ['File Size', metadata ? formatFileSize(metadata.file_size) : formatFileSize(image.size)],
                ['Modified', image.modified_str],
              ] as [string, string][]).map(([label, val]) => (
                <div key={label} className="flex items-start gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                  <span className="text-foreground break-all">{val}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Node summary */}
          {metadata?.workflow_summary?.nodes && metadata.workflow_summary.nodes.length > 0 && (
            <Section title="Node Summary" storageKey="nodes" defaultOpen>
              <div className="max-h-[400px] overflow-y-auto">
                {metadata.workflow_summary.nodes.map((node, i) => (
                  <NodeCard key={`${node.id}-${i}`} node={node} />
                ))}
              </div>
            </Section>
          )}

          {/* ComfyUI Prompt (raw) */}
          {metadata?.prompt != null && (
            <Section title="ComfyUI Prompt" storageKey="prompt">
              <div className="relative">
                <pre className="text-[10px] font-mono bg-background/50 rounded border border-border p-2 overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
                  {JSON.stringify(metadata.prompt, null, 2)}
                </pre>
                <div className="absolute top-2 right-2">
                  <CopyButton text={JSON.stringify(metadata.prompt, null, 2)} label="Copy prompt JSON" />
                </div>
              </div>
            </Section>
          )}

          {/* ComfyUI Workflow (raw) */}
          {metadata?.workflow != null && (
            <Section title="ComfyUI Workflow" storageKey="workflow">
              <div className="relative">
                <pre className="text-[10px] font-mono bg-background/50 rounded border border-border p-2 overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
                  {JSON.stringify(metadata.workflow, null, 2)}
                </pre>
                <div className="absolute top-2 right-2">
                  <CopyButton text={JSON.stringify(metadata.workflow, null, 2)} label="Copy workflow JSON" />
                </div>
              </div>
            </Section>
          )}

          {/* Other PNG params */}
          {metadata?.parameters && Object.keys(metadata.parameters).length > 0 && (
            <Section title="Parameters" storageKey="params">
              <div className="space-y-1 text-xs">
                {Object.entries(metadata.parameters).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2">
                    <span className="text-muted-foreground w-24 shrink-0 truncate">{k}</span>
                    <span className="text-foreground font-mono text-[10px] break-all">{v}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </aside>
  )
}
