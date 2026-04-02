import { useState, useCallback } from 'react'
import { Folder, Star, Download, Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ContextMenu, { type ContextMenuState } from './ContextMenu'
import type { GalleryImage, GalleryFolder } from './types'

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/')
}

interface Props {
  folders: GalleryFolder[]
  images: GalleryImage[]
  currentPath: string
  selectedImages: Set<string>
  onNavigate: (path: string) => void
  onSelect: (img: GalleryImage) => void
  onBatchFavorite: (is_favorite: boolean) => Promise<void>
  onClearSelection: () => void
  onDeleteImage: (img: GalleryImage) => void
  onDeleteFolder: (folder: GalleryFolder) => void
  onDeleteSelected: () => void
}

export default function GridView({
  folders,
  images,
  currentPath,
  selectedImages,
  onNavigate,
  onSelect,
  onBatchFavorite,
  onClearSelection,
  onDeleteImage,
  onDeleteFolder,
  onDeleteSelected,
}: Props) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const openImageMenu = (e: React.MouseEvent, img: GalleryImage) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: 'Delete image',
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'destructive',
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
          label: 'Delete folder',
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'destructive',
          onClick: () => onDeleteFolder(folder),
        },
      ],
    })
  }

  const handleImageClick = useCallback(
    (img: GalleryImage, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedIndex !== null) {
        // Range select
        const lo = Math.min(lastClickedIndex, index)
        const hi = Math.max(lastClickedIndex, index)
        for (let i = lo; i <= hi; i++) {
          if (!selectedImages.has(images[i].path)) onSelect(images[i])
        }
      } else {
        onSelect(img)
        setLastClickedIndex(index)
      }
    },
    [lastClickedIndex, selectedImages, images, onSelect]
  )

  const downloadMultiple = async () => {
    const paths = Array.from(selectedImages)
    const res = await fetch('/api/gallery/download-multiple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `images_${paths.length}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  const parts = currentPath ? currentPath.split('/') : []

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

      {/* Selection toolbar */}
      {selectedImages.size > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-border bg-primary/5 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{selectedImages.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onBatchFavorite(true)} className="gap-1.5">
              <Star className="w-3.5 h-3.5" />
              Favourite
            </Button>
            <Button size="sm" variant="outline" onClick={() => onBatchFavorite(false)} className="gap-1.5">
              <Star className="w-3.5 h-3.5" />
              Unfavourite
            </Button>
            <Button size="sm" variant="outline" onClick={downloadMultiple} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Download
            </Button>
            <Button size="sm" variant="destructive" onClick={onDeleteSelected} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={onClearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {/* Folder tiles */}
          {folders.map(folder => (
            <button
              key={folder.path}
              onDoubleClick={() => onNavigate(folder.path)}
              onClick={() => onNavigate(folder.path)}
              onContextMenu={e => openFolderMenu(e, folder)}
              className="aspect-square rounded border border-border bg-accent/30 hover:bg-accent flex flex-col items-center justify-center gap-2 transition-colors text-muted-foreground hover:text-foreground"
            >
              <Folder className="w-12 h-12" />
              <span className="text-xs truncate w-full text-center px-2">{folder.name}</span>
            </button>
          ))}

          {/* Image tiles */}
          {images.map((img, index) => {
            const isSelected = selectedImages.has(img.path)
            return (
              <button
                key={img.path}
                onClick={e => handleImageClick(img, index, e)}
                onContextMenu={e => openImageMenu(e, img)}
                className={cn(
                  'aspect-square rounded overflow-hidden border-2 relative group transition-all',
                  isSelected ? 'border-primary ring-1 ring-primary' : 'border-transparent hover:border-border'
                )}
              >
                <img
                  src={`/api/gallery/thumbnail/${encodePath(img.path)}`}
                  alt={img.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />

                {/* Checkbox overlay */}
                <div
                  className={cn(
                    'absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-opacity',
                    isSelected
                      ? 'opacity-100 bg-primary border-primary'
                      : 'opacity-0 group-hover:opacity-100 bg-background/80 border-border'
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>

                {/* Favourite star */}
                {img.is_favorite && (
                  <Star
                    className="absolute top-1.5 right-1.5 w-4 h-4 text-yellow-400 drop-shadow"
                    fill="currentColor"
                  />
                )}

                {/* Name on hover */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {img.name}
                </div>
              </button>
            )
          })}

          {folders.length === 0 && images.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No images found
            </div>
          )}
        </div>
      </div>

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}
