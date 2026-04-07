import { useState } from 'react'
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FolderTreeNode } from './types'

interface Props {
  tree: FolderTreeNode[]
  currentPath: string
  onNavigate: (path: string) => void
  showFavoritesOnly: boolean
  isAdmin: boolean
  onMove?: (imagePath: string, destFolder: string) => void
}

function TreeNode({
  node,
  currentPath,
  onNavigate,
  onMove,
  depth,
}: {
  node: FolderTreeNode
  currentPath: string
  onNavigate: (path: string) => void
  onMove?: (imagePath: string, destFolder: string) => void
  depth: number
}) {
  const isActive = currentPath === node.path
  const hasChildren = node.children.length > 0
  const [expanded, setExpanded] = useState(
    () => currentPath.startsWith(node.path + '/') || currentPath === node.path
  )
  const [dragOver, setDragOver] = useState(false)

  return (
    <div>
      <button
        onClick={() => {
          onNavigate(node.path)
          if (hasChildren) setExpanded(v => !v)
        }}
        onDragOver={e => {
          if (!e.dataTransfer.types.includes('gallery/image')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
        }}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const imagePath = e.dataTransfer.getData('gallery/image')
          if (imagePath && onMove) onMove(imagePath, node.path)
        }}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-left transition-colors',
          dragOver
            ? 'bg-primary/30 text-primary ring-1 ring-primary'
            : isActive
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 h-3.5 shrink-0" />
        )}
        {isActive ? (
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onMove={onMove}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree({ tree, currentPath, onNavigate, showFavoritesOnly, isAdmin, onMove }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
          Folders
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {/* Root — only for admins */}
        {isAdmin && (
          <button
            onClick={() => onNavigate('')}
            className={cn(
              'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-left transition-colors',
              currentPath === '' && !showFavoritesOnly
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <span className="w-3.5 h-3.5 shrink-0" />
            {currentPath === '' && !showFavoritesOnly ? (
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate font-medium">All Output</span>
          </button>
        )}

        {tree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            currentPath={currentPath}
            onNavigate={onNavigate}
            onMove={onMove}
            depth={0}
          />
        ))}
      </nav>
    </aside>
  )
}
