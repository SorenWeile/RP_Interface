import { useState, useEffect, useCallback, useRef } from 'react'
import { Star, LayoutGrid, Columns2, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toaster'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FolderTree from './FolderTree'
import DetailView from './DetailView'
import GridView from './GridView'
import MetadataPanel from './MetadataPanel'
import GalleryFilterPanel, {
  type FilterOptions,
  type ActiveFilters,
  emptyFilters,
  deriveAllowedPaths,
} from './GalleryFilterPanel'
import type { GalleryImage, GalleryFolder, FolderTreeNode, ImageMetadata } from './types'

// ---------------------------------------------------------------------------
// Path filtering helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `path` is under any of the given client_id prefixes.
 * e.g. path="ComfyUI/Deployed/HD/Proj/4k/img.png", clientId="Deployed/HD" → true
 */
function isPathAllowed(path: string, clientIds: string[]): boolean {
  const norm = '/' + path.replace(/\\/g, '/').replace(/^\/|\/$/g, '') + '/'
  return clientIds.some(cid => {
    const needle = '/' + cid.replace(/^\/|\/$/g, '') + '/'
    return norm.includes(needle)
  })
}

/** Recursively filter tree: keep a node if it is allowed or has allowed descendants. */
function filterTree(nodes: FolderTreeNode[], clientIds: string[]): FolderTreeNode[] {
  return nodes
    .map(node => ({ ...node, children: filterTree(node.children, clientIds) }))
    .filter(node => isPathAllowed(node.path, clientIds) || node.children.length > 0)
}

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

async function apiPathOptions(): Promise<{
  is_admin: boolean
  clients: { id: number; client_id: string }[]
  projects: { id: number; project_id: string; client_id: number | null }[]
}> {
  const token = localStorage.getItem('user_token') ?? ''
  const r = await fetch('/api/auth/path-options', { headers: { 'X-User-Token': token } })
  if (!r.ok) return { is_admin: false, clients: [], projects: [] }
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
  // null = admin (no filter), string[] = allowed "clientId/projectId" path segments
  const [allowedPaths, setAllowedPaths] = useState<string[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ clients: [], projects: [], users: [] })
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters())
  const [folderWidth, setFolderWidth] = useState(224)
  const folderWidthRef = useRef(224)

  const startFolderResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = folderWidthRef.current
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(160, Math.min(480, startWidth + ev.clientX - startX))
      folderWidthRef.current = next
      setFolderWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => { folderWidthRef.current = folderWidth }, [folderWidth])

  type DeleteConfirm = { label: string; onConfirm: () => Promise<void> }
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  type RenameTarget = { img: GalleryImage; name: string }
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const { toast } = useToast()

  // When admin changes the filter, derive new allowedPaths and re-filter the tree
  const handleFilterChange = useCallback((f: ActiveFilters) => {
    setActiveFilters(f)
    const derived = deriveAllowedPaths(f, filterOptions)
    setAllowedPaths(derived)
    apiTree().then(rawTree => {
      setTree(derived ? filterTree(rawTree, derived) : rawTree)
      if (derived !== null && derived.length === 0) {
        setCurrentPath('')
      }
    })
  }, [filterOptions])

  // Load path permissions + folder tree together
  useEffect(() => {
    const token = localStorage.getItem('user_token') ?? ''
    Promise.all([apiTree(), apiPathOptions()]).then(([rawTree, opts]) => {
      if (opts.is_admin) {
        setIsAdmin(true)
        setAllowedPaths(null)
        setTree(rawTree)
        // Load filter options (clients/projects/users) for admins
        fetch('/api/auth/gallery-filter-options', { headers: { 'X-User-Token': token } })
          .then(r => r.ok ? r.json() : { clients: [], projects: [], users: [] })
          .then(setFilterOptions)
          .catch(() => {})
      } else {
        setIsAdmin(false)
        // Build "clientId/projectId" segments from the user's assigned projects
        const clientMap = new Map(opts.clients.map(c => [c.id, c.client_id]))
        const paths = opts.projects.map(p => {
          const clientStr = p.client_id != null ? clientMap.get(p.client_id) : null
          return clientStr ? `${clientStr}/${p.project_id}` : p.project_id
        })
        setAllowedPaths(paths)
        const filtered = filterTree(rawTree, paths)
        setTree(filtered)
        // Auto-navigate to first allowed folder if at root
        setCurrentPath(prev => {
          if (prev === '' && filtered.length > 0) return filtered[0].path
          return prev
        })
      }
    }).catch(console.error)
  }, [])

  // Load browse results whenever path or favorites filter changes
  const loadBrowse = useCallback(
    async (path: string, favOnly: boolean) => {
      setLoading(true)
      try {
        if (favOnly) {
          const fav = await apiFavorites()
          const favImgs: GalleryImage[] = fav.images ?? []
          setImages(allowedPaths ? favImgs.filter(i => isPathAllowed(i.path, allowedPaths)) : favImgs)
          setFolders([])
        } else {
          const data = await apiBrowse(path)
          const rawFolders: GalleryFolder[] = data.folders ?? []
          const rawImages: GalleryImage[] = data.images ?? []
          const filteredFolders = allowedPaths
            ? rawFolders.filter(f =>
                isPathAllowed(f.path, allowedPaths) ||
                filterTree([{ name: f.name, path: f.path, type: 'folder', children: [] }], allowedPaths).length > 0
              )
            : rawFolders
          const filteredImages = allowedPaths
            ? rawImages.filter(i => isPathAllowed(i.path, allowedPaths))
            : rawImages
          setFolders(filteredFolders)
          setImages(filteredImages)
          const VIDEO_EXTS = ['.mp4', '.webm', '.mov']
          const thumbnailable = filteredImages.filter(
            i => !VIDEO_EXTS.some(ext => i.name.toLowerCase().endsWith(ext))
          )
          if (thumbnailable.length) {
            apiGenerateThumbnails(thumbnailable.map(i => i.path))
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
    [allowedPaths]
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
        toast(
          is_favorite
            ? `${paths.length} image${paths.length !== 1 ? 's' : ''} starred`
            : `${paths.length} image${paths.length !== 1 ? 's' : ''} unstarred`,
          'success'
        )
      } catch {
        toast('Failed to update favourites', 'error')
      }
    },
    [selectedImages, toast]
  )

  const toggleImageSelection = useCallback((img: GalleryImage) => {
    setSelectedImages(prev => {
      const next = new Set(prev)
      next.has(img.path) ? next.delete(img.path) : next.add(img.path)
      return next
    })
  }, [])

  const moveImage = useCallback(async (imagePath: string, destFolder: string) => {
    try {
      const res = await fetch('/api/gallery/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_path: imagePath, dest_folder: destFolder }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        toast(err.detail ?? 'Move failed', 'error')
        return
      }
      setImages(prev => prev.filter(i => i.path !== imagePath))
      setSelectedImages(prev => { const n = new Set(prev); n.delete(imagePath); return n })
      toast('Image moved', 'success')
    } catch {
      toast('Move failed', 'error')
    }
  }, [toast])

  const handleRename = useCallback(async (img: GalleryImage, newName: string) => {
    try {
      const res = await fetch('/api/gallery/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: img.path, new_name: newName }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        toast(err.detail ?? 'Rename failed', 'error')
        return
      }
      const { new_path, name } = await res.json()
      setImages(prev => prev.map(i => i.path === img.path ? { ...i, path: new_path, name } : i))
      toast(`Renamed to "${name}"`, 'success')
    } catch {
      toast('Rename failed', 'error')
    }
  }, [toast])

  const refreshTree = async () => {
    await fetch('/api/gallery/tree/refresh')
    apiTree().then(rawTree => {
      setTree(allowedPaths ? filterTree(rawTree, allowedPaths) : rawTree)
    })
    loadBrowse(currentPath, showFavoritesOnly)
  }

  const confirmDeleteImage = useCallback((img: GalleryImage) => {
    setDeleteConfirm({
      label: `Delete "${img.name}"?`,
      onConfirm: async () => {
        const token = localStorage.getItem('user_token') ?? ''
        const encoded = img.path.split('/').map(encodeURIComponent).join('/')
        try {
          const response = await fetch(`/api/gallery/image/${encoded}`, {
            method: 'DELETE',
            headers: { 'X-User-Token': token }
          })
          if (!response.ok) {
            if (response.status === 403) throw new Error('Not authorized to delete this image')
            else if (response.status === 401) throw new Error('Please log in to delete images')
            else throw new Error('Failed to delete image')
          }
          setImages(prev => prev.filter(i => i.path !== img.path))
          setSelectedImages(prev => { const n = new Set(prev); n.delete(img.path); return n })
          toast('Image deleted', 'success')
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Delete failed', 'error')
        }
      },
    })
  }, [toast])

  const confirmDeleteFolder = useCallback((folder: GalleryFolder) => {
    setDeleteConfirm({
      label: `Delete folder "${folder.name}" and all its images?`,
      onConfirm: async () => {
        const token = localStorage.getItem('user_token') ?? ''
        const encoded = folder.path.split('/').map(encodeURIComponent).join('/')
        try {
          const response = await fetch(`/api/gallery/folder/${encoded}`, {
            method: 'DELETE',
            headers: { 'X-User-Token': token }
          })
          if (!response.ok) {
            if (response.status === 403) throw new Error('Not authorized to delete this folder')
            else if (response.status === 401) throw new Error('Please log in to delete folders')
            else throw new Error('Failed to delete folder')
          }
          setFolders(prev => prev.filter(f => f.path !== folder.path))
          await fetch('/api/gallery/tree/refresh')
          apiTree().then(rawTree => setTree(allowedPaths ? filterTree(rawTree, allowedPaths) : rawTree))
          toast(`Folder "${folder.name}" deleted`, 'success')
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Delete failed', 'error')
        }
      },
    })
  }, [allowedPaths, toast])

  const confirmDeleteSelected = useCallback(() => {
    const count = selectedImages.size
    if (count === 0) return
    setDeleteConfirm({
      label: `Delete ${count} selected image${count !== 1 ? 's' : ''}?`,
      onConfirm: async () => {
        const token = localStorage.getItem('user_token') ?? ''
        try {
          const response = await fetch('/api/gallery/delete-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
            body: JSON.stringify({ paths: Array.from(selectedImages) }),
          })
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            if (response.status === 403) {
              const n = errorData.unauthorized?.length || 0
              throw new Error(`Not authorized to delete ${n} image${n !== 1 ? 's' : ''}`)
            } else if (response.status === 401) {
              throw new Error('Please log in to delete images')
            } else {
              const n = errorData.errors?.length || 0
              throw new Error(`Failed to delete ${n} image${n !== 1 ? 's' : ''}`)
            }
          }
          const result = await response.json()
          setImages(prev => prev.filter(i => !selectedImages.has(i.path)))
          setSelectedImages(new Set())
          if (result.unauthorized?.length > 0) {
            toast(`Deleted ${result.deleted} images — ${result.unauthorized.length} not authorized`, 'info')
          } else {
            toast(`Deleted ${result.deleted ?? count} image${count !== 1 ? 's' : ''}`, 'success')
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Delete failed', 'error')
        }
      },
    })
  }, [selectedImages, toast])

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
          {isAdmin && (
            <GalleryFilterPanel
              options={filterOptions}
              filters={activeFilters}
              onChange={handleFilterChange}
            />
          )}
          <Button variant="outline" size="icon" onClick={refreshTree} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Three-panel body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: folder tree + drag handle */}
        {!showFavoritesOnly && (
          <>
            <FolderTree
              tree={tree}
              currentPath={currentPath}
              onNavigate={navigate}
              showFavoritesOnly={showFavoritesOnly}
              isAdmin={isAdmin && allowedPaths === null}
              onMove={moveImage}
              width={folderWidth}
            />
            <div
              className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/60 transition-colors"
              onMouseDown={startFolderResize}
            />
          </>
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
              onDeleteImage={confirmDeleteImage}
              onDeleteFolder={confirmDeleteFolder}
              onRenameImage={img => setRenameTarget({ img, name: img.name })}
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
              onDeleteImage={confirmDeleteImage}
              onDeleteFolder={confirmDeleteFolder}
              onDeleteSelected={confirmDeleteSelected}
              onRenameImage={img => setRenameTarget({ img, name: img.name })}
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

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-xl space-y-4">
            <p className="text-sm font-medium text-foreground">Rename file</p>
            <Input
              autoFocus
              value={renameTarget.name}
              onChange={e => setRenameTarget(t => t ? { ...t, name: e.target.value } : null)}
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  const { img, name } = renameTarget
                  setRenameTarget(null)
                  await handleRename(img, name)
                } else if (e.key === 'Escape') {
                  setRenameTarget(null)
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={async () => {
                  const { img, name } = renameTarget
                  setRenameTarget(null)
                  await handleRename(img, name)
                }}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-xl space-y-4">
            <p className="text-sm text-foreground">{deleteConfirm.label}</p>
            <p className="text-xs text-muted-foreground">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await deleteConfirm.onConfirm()
                  setDeleteConfirm(null)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
