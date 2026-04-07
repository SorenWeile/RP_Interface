import { useRef, useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Star, Download, Folder, Trash2, Copy, FileJson, GitBranch, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import ContextMenu, { type ContextMenuState } from './ContextMenu'
import type { GalleryImage, GalleryFolder } from './types'

async function fetchMetadataForCopy(path: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const r = await fetch(`/api/gallery/metadata/${encoded}`)
  if (!r.ok) return null
  return r.json()
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/')
}

interface Props {
  folders: GalleryFolder[]
  images: GalleryImage[]
  selectedIndex: number
  currentPath: string
  loading: boolean
  onSelectIndex: (i: number) => void
  onNavigate: (path: string) => void
  onToggleFavorite: (img: GalleryImage) => void
  onDeleteImage: (img: GalleryImage) => void
  onDeleteFolder: (folder: GalleryFolder) => void
  onRenameImage: (img: GalleryImage) => void
}

export default function DetailView({
  folders,
  images,
  selectedIndex,
  currentPath,
  loading,
  onSelectIndex,
  onNavigate,
  onToggleFavorite,
  onDeleteImage,
  onDeleteFolder,
  onRenameImage,
}: Props) {
  const selectedImage = images[selectedIndex] ?? null
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const openImageMenu = (e: React.MouseEvent, img: GalleryImage) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: 'Copy path',
          icon: <Copy className="w-4 h-4" />,
          onClick: () => copyToClipboard(img.path),
        },
        {
          label: 'Copy metadata as JSON',
          icon: <FileJson className="w-4 h-4" />,
          onClick: async () => {
            const meta = await fetchMetadataForCopy(img.path)
            if (meta) copyToClipboard(JSON.stringify(meta, null, 2))
          },
        },
        {
          label: 'Copy workflow JSON',
          icon: <GitBranch className="w-4 h-4" />,
          onClick: async () => {
            const meta = await fetchMetadataForCopy(img.path)
            if (meta?.workflow) copyToClipboard(JSON.stringify(meta.workflow, null, 2))
            else if (meta?.prompt) copyToClipboard(JSON.stringify(meta.prompt, null, 2))
          },
        },
        { separator: true as const },
        {
          label: 'Rename',
          icon: <Pencil className="w-4 h-4" />,
          onClick: () => onRenameImage(img),
        },
        {
          label: 'Delete image',
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'destructive' as const,
          onClick: () => onDeleteImage(img),
        },
      ],
    })
  }

  const openFolderMenu = (e: React.MouseEvent, folder: GalleryFolder) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: 'Copy path',
          icon: <Copy className="w-4 h-4" />,
          onClick: () => copyToClipboard(folder.path),
        },
        {
          label: 'Download as ZIP',
          icon: <Download className="w-4 h-4" />,
          onClick: () => {
            const encoded = folder.path.split('/').map(encodeURIComponent).join('/')
            const a = document.createElement('a')
            a.href = `/api/gallery/download-folder/${encoded}`
            a.download = `${folder.name}.zip`
            a.click()
          },
        },
        { separator: true as const },
        {
          label: 'Delete folder',
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'destructive' as const,
          onClick: () => onDeleteFolder(folder),
        },
      ],
    })
  }

  // Zoom / pan state
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  const viewerRef = useRef<HTMLDivElement>(null)
  const thumbStripRef = useRef<HTMLDivElement>(null)

  // Reset zoom when image changes
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [selectedImage?.path])

  // Scroll thumbnail strip to active item
  useEffect(() => {
    if (!thumbStripRef.current) return
    const active = thumbStripRef.current.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedIndex, folders.length])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale(s => Math.min(10, Math.max(0.1, s * (e.deltaY < 0 ? 1.15 : 0.87))))
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [offset])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    })
  }, [])

  const handlePointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const fitToScreen = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  // Breadcrumb
  const parts = currentPath ? currentPath.split('/') : []

  // Total items in thumbnail strip = folders + images
  const totalItems = folders.length + images.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb */}
      {currentPath && (
        <div className="shrink-0 px-3 py-1.5 border-b border-border flex items-center gap-1 text-xs text-muted-foreground">
          <button onClick={() => onNavigate('')} className="hover:text-foreground transition-colors">
            Root
          </button>
          {parts.map((part, i) => {
            const path = parts.slice(0, i + 1).join('/')
            return (
              <span key={path} className="flex items-center gap-1">
                <span>/</span>
                <button
                  onClick={() => onNavigate(path)}
                  className={cn(
                    'hover:text-foreground transition-colors',
                    i === parts.length - 1 && 'text-foreground font-medium'
                  )}
                >
                  {part}
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Image viewer */}
      <div
        ref={viewerRef}
        className="flex-1 relative overflow-hidden bg-black/20 cursor-grab active:cursor-grabbing select-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-muted-foreground text-sm">Loading…</div>
          </div>
        )}

        {!loading && selectedImage && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          >
            <img
              src={`/api/gallery/image/${encodePath(selectedImage.path)}`}
              alt={selectedImage.name}
              className="max-w-none max-h-none object-contain"
              style={{ maxWidth: '100%', maxHeight: '100%' }}
              draggable={false}
            />
          </div>
        )}

        {!loading && !selectedImage && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            {totalItems === 0 ? 'No images in this folder' : 'Select an image'}
          </div>
        )}

        {/* Zoom controls overlay */}
        {selectedImage && (
          <div className="absolute top-3 right-3 flex flex-col gap-1.5">
            <button
              onClick={() => onToggleFavorite(selectedImage)}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background transition-colors',
                selectedImage.is_favorite && 'text-yellow-400'
              )}
              title="Toggle favourite"
            >
              <Star className="w-4 h-4" fill={selectedImage.is_favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => setScale(s => Math.min(10, s * 1.25))}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setScale(s => Math.max(0.1, s * 0.8))}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={fitToScreen}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background transition-colors"
              title="Fit to screen"
            >
              <Maximize className="w-4 h-4" />
            </button>
            <a
              href={`/api/gallery/download/${encodePath(selectedImage.path)}`}
              download={selectedImage.name}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background transition-colors"
              title="Download"
              onClick={e => e.stopPropagation()}
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* Prev / Next arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => onSelectIndex(Math.min(images.length - 1, selectedIndex + 1))}
              disabled={selectedIndex === images.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-background/80 border border-border hover:bg-background disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Image info bar */}
      {selectedImage && (
        <div className="shrink-0 px-3 py-1 border-t border-border text-xs text-muted-foreground flex items-center gap-3">
          <span className="font-medium text-foreground truncate">{selectedImage.name}</span>
          <span>{(selectedImage.size / 1024).toFixed(0)} KB</span>
          <span>{selectedImage.modified_str}</span>
        </div>
      )}

      {/* Thumbnail strip */}
      <div
        ref={thumbStripRef}
        className="shrink-0 h-[180px] border-t border-border bg-card flex items-center gap-2 overflow-x-auto px-2 py-2"
      >
        {/* Folder tiles */}
        {folders.map(folder => (
          <button
            key={folder.path}
            onClick={() => onNavigate(folder.path)}
            onContextMenu={e => openFolderMenu(e, folder)}
            className="shrink-0 w-[160px] h-[156px] rounded border border-border bg-accent/30 hover:bg-accent flex flex-col items-center justify-center gap-2 transition-colors text-muted-foreground hover:text-foreground"
          >
            <Folder className="w-10 h-10" />
            <span className="text-xs truncate w-full text-center px-2">{folder.name}</span>
          </button>
        ))}

        {/* Image thumbnails */}
        {images.map((img, i) => (
          <button
            key={img.path}
            data-active={i === selectedIndex}
            draggable
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('gallery/image', img.path)
            }}
            onClick={() => onSelectIndex(i)}
            onContextMenu={e => openImageMenu(e, img)}
            className={cn(
              'shrink-0 w-[156px] h-[156px] rounded overflow-hidden border-2 transition-colors relative',
              i === selectedIndex ? 'border-primary' : 'border-transparent hover:border-border'
            )}
          >
            <img
              src={`/api/gallery/thumbnail/${encodePath(img.path)}`}
              alt={img.name}
              className="w-full h-full object-cover"
              loading="lazy"
              draggable={false}
            />
            {img.is_favorite && (
              <Star
                className="absolute top-1 right-1 w-3.5 h-3.5 text-yellow-400 drop-shadow"
                fill="currentColor"
              />
            )}
          </button>
        ))}

        {folders.length === 0 && images.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            Empty folder
          </div>
        )}
      </div>

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}
