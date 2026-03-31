import { useState, useEffect, useCallback } from 'react'
import { Star, LayoutGrid, Columns2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import FolderTree from './FolderTree'
import DetailView from './DetailView'
import GridView from './GridView'
import MetadataPanel from './MetadataPanel'
import type { GalleryImage, GalleryFolder, FolderTreeNode, ImageMetadata } from './types'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiBrowse(path: string) {
  const r = await fetch(`/api/gallery/browse${path ? '/' + path : ''}`)
  if (!r.ok) throw new Error(`Browse failed: ${r.status}`)
  return r.json()
}

async function apiTree(): Promise<FolderTreeNode[]> {
  const r = await fetch('/api/gallery/tree')
  if (!r.ok) return []
  return r.json()
}

async function apiMetadata(path: string): Promise<ImageMetadata> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const r = await fetch(`/api/gallery/metadata/${encoded}`)
  if (!r.ok) throw new Error('Metadata not found')
  return r.json()
}

async function apiFavorites() {
  const r = await fetch('/api/gallery/favorites')
  if (!r.ok) return { images: [] }
  return r.json()
}

async function apiToggleFavorite(path: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const r = await fetch(`/api/gallery/favorite/${encoded}`, { method: 'POST' })
  if (!r.ok) throw new Error('Toggle failed')
  return r.json()
}

async function apiFavoriteBatch(paths: string[], is_favorite: boolean) {
  const r = await fetch('/api/gallery/favorite-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_paths: paths, is_favorite }),
  })
  if (!r.ok) throw new Error('Batch favorite failed')
  return r.json()
}

async function apiGenerateThumbnails(images: string[]) {
  await fetch('/api/gallery/generate-thumbnails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ViewMode = 'detail' | 'grid'

export default function Gallery() {
  const [tree, setTree] = useState<FolderTreeNode[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState<GalleryFolder[]>([])
  const [images, setImages] = useState<GalleryImage[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set())
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  // Load folder tree once
  useEffect(() => {
    apiTree().then(setTree).catch(console.error)
  }, [])

  // Load browse results whenever path or favorites filter changes
  const loadBrowse = useCallback(
    async (path: string, favOnly: boolean) => {
      setLoading(true)
      try {
        if (favOnly) {
          const fav = await apiFavorites()
          setImages(fav.images ?? [])
          setFolders([])
        } else {
          const data = await apiBrowse(path)
          setFolders(data.folders ?? [])
          setImages(data.images ?? [])
          // Kick off background thumbnail generation
          if (data.images?.length) {
            apiGenerateThumbnails(data.images.map((i: GalleryImage) => i.path))
          }
        }
        setSelectedIndex(0)
        setSelectedImages(new Set())
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    loadBrowse(currentPath, showFavoritesOnly)
  }, [currentPath, showFavoritesOnly, loadBrowse])

  // Load metadata when selected image changes (detail view only)
  const selectedImage = images[selectedIndex] ?? null

  useEffect(() => {
    if (!selectedImage || viewMode !== 'detail') {
      setMetadata(null)
      return
    }
    setMetadataLoading(true)
    apiMetadata(selectedImage.path)
      .then(setMetadata)
      .catch(() => setMetadata(null))
      .finally(() => setMetadataLoading(false))
  }, [selectedImage?.path, viewMode])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (viewMode !== 'detail') return
      if (e.key === 'ArrowLeft') setSelectedIndex(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setSelectedIndex(i => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [viewMode, images.length])

  const navigate = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const toggleFavorite = useCallback(async (img: GalleryImage) => {
    try {
      const result = await apiToggleFavorite(img.path)
      setImages(prev =>
        prev.map(i => (i.path === img.path ? { ...i, is_favorite: result.is_favorite } : i))
      )
    } catch (e) {
      console.error(e)
    }
  }, [])

  const batchFavorite = useCallback(
    async (is_favorite: boolean) => {
      const paths = Array.from(selectedImages)
      try {
        await apiFavoriteBatch(paths, is_favorite)
        setImages(prev =>
          prev.map(i => (selectedImages.has(i.path) ? { ...i, is_favorite } : i))
        )
      } catch (e) {
        console.error(e)
      }
    },
    [selectedImages]
  )

  const toggleImageSelection = useCallback((img: GalleryImage) => {
    setSelectedImages(prev => {
      const next = new Set(prev)
      next.has(img.path) ? next.delete(img.path) : next.add(img.path)
      return next
    })
  }, [])

  const refreshTree = async () => {
    await fetch('/api/gallery/tree/refresh')
    apiTree().then(setTree)
    loadBrowse(currentPath, showFavoritesOnly)
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Gallery toolbar */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {showFavoritesOnly
            ? `${images.length} favourite${images.length !== 1 ? 's' : ''}`
            : `${folders.length} folder${folders.length !== 1 ? 's' : ''}, ${images.length} image${images.length !== 1 ? 's' : ''}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={showFavoritesOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFavoritesOnly(v => !v)}
            className="gap-1.5"
          >
            <Star className="w-3.5 h-3.5" fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            Favourites
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(v => (v === 'grid' ? 'detail' : 'grid'))}
            className="gap-1.5"
          >
            {viewMode === 'grid' ? (
              <Columns2 className="w-3.5 h-3.5" />
            ) : (
              <LayoutGrid className="w-3.5 h-3.5" />
            )}
            {viewMode === 'grid' ? 'Detail' : 'Grid'}
          </Button>
          <Button variant="outline" size="icon" onClick={refreshTree} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Three-panel body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: folder tree */}
        {!showFavoritesOnly && (
          <FolderTree
            tree={tree}
            currentPath={currentPath}
            onNavigate={navigate}
            showFavoritesOnly={showFavoritesOnly}
          />
        )}

        {/* Center: content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === 'detail' ? (
            <DetailView
              folders={folders}
              images={images}
              selectedIndex={selectedIndex}
              currentPath={currentPath}
              loading={loading}
              onSelectIndex={setSelectedIndex}
              onNavigate={navigate}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <GridView
              folders={folders}
              images={images}
              currentPath={currentPath}
              selectedImages={selectedImages}
              onNavigate={navigate}
              onSelect={toggleImageSelection}
              onBatchFavorite={batchFavorite}
              onClearSelection={() => setSelectedImages(new Set())}
            />
          )}
        </div>

        {/* Right: metadata (detail view only) */}
        {viewMode === 'detail' && (
          <MetadataPanel
            image={selectedImage}
            metadata={metadata}
            loading={metadataLoading}
            onToggleFavorite={toggleFavorite}
          />
        )}
      </div>
    </div>
  )
}
