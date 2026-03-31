export interface GalleryFolder {
  path: string
  name: string
  modified: number
  modified_str: string
}

export interface GalleryImage {
  path: string
  name: string
  size: number
  modified: number
  modified_str: string
  is_favorite?: boolean
}

export interface FolderTreeNode {
  name: string
  path: string
  type: 'folder'
  children: FolderTreeNode[]
}

export interface BrowseResult {
  current_path: string
  folders: GalleryFolder[]
  images: GalleryImage[]
}

export interface WorkflowNode {
  id: string | number
  type: string
  title: string
  params: Record<string, unknown>
}

export interface ImageMetadata {
  format: string | null
  size: { width: number; height: number }
  mode: string | null
  file_size: number
  prompt: unknown
  workflow: unknown
  workflow_summary: { nodes: WorkflowNode[] } | null
  parameters: Record<string, string>
  error?: string
}
