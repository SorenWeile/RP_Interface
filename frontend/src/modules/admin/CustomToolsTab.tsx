import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getIcon } from '@/lib/icons'
import { listTools, deleteTool } from '@/api/client'
import type { ToolSummary } from '@/modules/workflow-builder/types'

interface Props {
  onDeleted?: () => void
}

export default function CustomToolsTab({ onDeleted }: Props) {
  const [tools,   setTools]   = useState<ToolSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<ToolSummary | null>(null)
  const [deleting,setDeleting]= useState(false)

  const load = () => {
    setLoading(true)
    listTools()
      .then(all => setTools(all.filter(t => !t.is_builtin)))
      .catch(() => setTools([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async () => {
    if (!confirm) return
    setDeleting(true)
    await deleteTool(confirm.id).catch(() => {})
    setDeleting(false)
    setConfirm(null)
    load()
    onDeleted?.()
  }

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>

  return (
    <>
      <div className="space-y-4">
        <div>
          <h2 className="text-foreground font-medium">Custom Tools</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tools created via the Workflow Builder.
          </p>
        </div>

        {tools.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-md">
            No custom tools yet. Click "+ New Tool" in the sidebar.
          </p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium w-10"></th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Name</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Description</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium w-20 hidden md:table-cell">Created</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tools.map(t => {
                  const Icon = getIcon(t.icon)
                  return (
                    <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2">
                        <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                          <Icon className="w-3.5 h-3.5 text-primary" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-foreground font-medium">{t.name}</td>
                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell truncate max-w-xs">
                        {t.description || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground hidden md:table-cell">
                        {new Date(t.created_at).toISOString().slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                          onClick={() => setConfirm(t)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setConfirm(null)}
        >
          <div
            className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-foreground font-medium">Delete "{confirm.name}"?</h3>
            <p className="text-xs text-muted-foreground">
              This cannot be undone. The workflow and all field configuration will be removed.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
