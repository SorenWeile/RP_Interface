import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadState = 'empty' | 'uploading' | 'ready' | 'error'

interface ImageSlot {
  preview: string | null
  filename: string | null
  state: UploadState
}

interface DropZoneProps {
  slot: ImageSlot
  label: string
  disabled?: boolean
  onFile: (file: File) => void
  onClear: () => void
  size?: 'lg' | 'sm'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DropZone({ slot, label, disabled, onFile, onClear, size = 'lg' }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && !disabled) onFile(file)
  }

  return (
    <div className="relative">
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

      {/* Clear button — only shown when a file is loaded and not busy */}
      {slot.preview && !disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className={cn(
            'absolute top-1 right-1 flex items-center justify-center rounded-full',
            'w-5 h-5 text-xs bg-background/80 border border-border text-muted-foreground',
            'hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors',
          )}
          title="Remove image"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Exports ──────────────────────────────────────────────────────────────────

export type { ImageSlot, UploadState, DropZoneProps }