import { useEffect, useRef, useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterClient  { id: number; client_id: string; name: string }
export interface FilterProject { id: number; project_id: string; name: string; client_id: number | null }
export interface FilterUser    { id: number; username: string; paths: string[] }

export interface FilterOptions {
  clients:  FilterClient[]
  projects: FilterProject[]
  users:    FilterUser[]
}

export interface ActiveFilters {
  clientIds:  Set<number>
  projectIds: Set<number>
  userIds:    Set<number>
}

export const emptyFilters = (): ActiveFilters => ({
  clientIds:  new Set(),
  projectIds: new Set(),
  userIds:    new Set(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the allowedPaths array from the active filters + filter options.
 * Returns null if nothing is selected (= no restriction).
 */
export function deriveAllowedPaths(
  filters: ActiveFilters,
  options: FilterOptions,
): string[] | null {
  const { clientIds, projectIds, userIds } = filters
  const hasClients  = clientIds.size > 0
  const hasProjects = projectIds.size > 0
  const hasUsers    = userIds.size > 0

  if (!hasClients && !hasProjects && !hasUsers) return null

  // Start: all possible clientId/projectId path segments
  const clientMap = new Map(options.clients.map(c => [c.id, c.client_id]))

  let segments: string[] = options.projects
    .map(p => {
      const cs = p.client_id != null ? clientMap.get(p.client_id) : null
      return cs ? `${cs}/${p.project_id}` : p.project_id
    })

  // Filter by selected clients
  if (hasClients) {
    segments = segments.filter(seg => {
      return options.projects.some(p => {
        const cs = p.client_id != null ? clientMap.get(p.client_id) : null
        const s  = cs ? `${cs}/${p.project_id}` : p.project_id
        return s === seg && p.client_id != null && clientIds.has(p.client_id)
      })
    })
  }

  // Filter by selected projects
  if (hasProjects) {
    segments = segments.filter(seg => {
      return options.projects.some(p => {
        const cs = p.client_id != null ? clientMap.get(p.client_id) : null
        const s  = cs ? `${cs}/${p.project_id}` : p.project_id
        return s === seg && projectIds.has(p.id)
      })
    })
  }

  // Intersect with selected users' paths
  if (hasUsers) {
    const userPaths = new Set<string>()
    options.users
      .filter(u => userIds.has(u.id))
      .forEach(u => u.paths.forEach(p => userPaths.add(p)))
    segments = segments.filter(s => userPaths.has(s))
  }

  return segments.length > 0 ? segments : []
}

// ---------------------------------------------------------------------------
// Section sub-component
// ---------------------------------------------------------------------------

function Section<T extends { id: number; name: string }>({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string
  items: T[]
  selected: Set<number>
  onToggle: (id: number) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">{title}</p>
      <div className="max-h-36 overflow-y-auto border border-border rounded-md divide-y divide-border">
        {items.map(item => (
          <label
            key={item.id}
            className={cn(
              'flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-xs transition-colors',
              selected.has(item.id) ? 'bg-primary/10' : 'hover:bg-accent',
            )}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => onToggle(item.id)}
              className="accent-primary"
            />
            <span className="flex-1 truncate">{item.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  options: FilterOptions
  filters: ActiveFilters
  onChange: (f: ActiveFilters) => void
}

export default function GalleryFilterPanel({ options, filters, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeCount =
    filters.clientIds.size + filters.projectIds.size + filters.userIds.size

  const toggle = (key: 'clientIds' | 'projectIds' | 'userIds', id: number) => {
    const next = new Set(filters[key])
    next.has(id) ? next.delete(id) : next.add(id)

    // Cascade: if a client is removed, remove its projects too
    let nextProjectIds = new Set(filters.projectIds)
    if (key === 'clientIds') {
      options.projects
        .filter(p => p.client_id != null && !next.has(p.client_id))
        .forEach(p => nextProjectIds.delete(p.id))
    } else if (key === 'projectIds') {
      nextProjectIds = next
    }

    onChange({
      clientIds:  key === 'clientIds'  ? next : filters.clientIds,
      projectIds: nextProjectIds,
      userIds:    key === 'userIds'    ? next : filters.userIds,
    })
  }

  const clearAll = () => onChange(emptyFilters())

  // Only show projects whose client is selected (or all if no client selected)
  const visibleProjects = filters.clientIds.size > 0
    ? options.projects.filter(p => p.client_id != null && filters.clientIds.has(p.client_id))
    : options.projects

  // Adapt users to have a `name` field for Section
  const userItems = options.users.map(u => ({ id: u.id, name: u.username }))

  return (
    <div className="relative" ref={ref}>
      <Button
        variant={activeCount > 0 ? 'default' : 'outline'}
        size="sm"
        onClick={() => setOpen(v => !v)}
        className="gap-1.5"
      >
        <Filter className="w-3.5 h-3.5" />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 bg-primary-foreground text-primary rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-card border border-border rounded-lg shadow-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Filter Gallery</p>
            {activeCount > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          <Section
            title="Clients"
            items={options.clients}
            selected={filters.clientIds}
            onToggle={id => toggle('clientIds', id)}
          />

          {visibleProjects.length > 0 && (
            <Section
              title="Projects"
              items={visibleProjects}
              selected={filters.projectIds}
              onToggle={id => toggle('projectIds', id)}
            />
          )}

          {userItems.length > 0 && (
            <Section
              title="Users"
              items={userItems}
              selected={filters.userIds}
              onToggle={id => toggle('userIds', id)}
            />
          )}
        </div>
      )}
    </div>
  )
}
