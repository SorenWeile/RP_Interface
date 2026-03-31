import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AdminGroup } from './types'

const authHeader = (token: string) => ({ 'X-Admin-Token': token, 'Content-Type': 'application/json' })

const ALL_MODULES: { id: string; label: string }[] = [
  { id: 'gallery',          label: 'Gallery' },
  { id: 'upscaler',         label: 'Upscaler' },
  { id: 'upscaler-rework',  label: 'Batch Upscaler' },
  { id: 'outfit-swapping',  label: 'Outfit Swapping' },
  { id: 'panorama',         label: 'Panorama Outpainting' },
]

// ---------------------------------------------------------------------------
// Group dialog
// ---------------------------------------------------------------------------

interface FormState {
  name: string
  can_access_admin: boolean
  allowed_modules: string[]
}

function GroupDialog({
  group,
  token,
  onSave,
  onClose,
}: {
  group: AdminGroup | null
  token: string
  onSave: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => ({
    name: group?.name ?? '',
    can_access_admin: group?.can_access_admin ?? false,
    allowed_modules: group?.allowed_modules ?? [],
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleModule = (id: string) => {
    setForm(prev => ({
      ...prev,
      allowed_modules: prev.allowed_modules.includes(id)
        ? prev.allowed_modules.filter(m => m !== id)
        : [...prev.allowed_modules, id],
    }))
  }

  const selectAll = () => setForm(prev => ({ ...prev, allowed_modules: ALL_MODULES.map(m => m.id) }))
  const selectNone = () => setForm(prev => ({ ...prev, allowed_modules: [] }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Group name is required'); return }
    setError('')
    setSaving(true)
    try {
      const url = group ? `/api/admin/groups/${group.id}` : '/api/admin/groups'
      const method = group ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeader(token),
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.detail ?? 'Save failed')
        return
      }
      onSave()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-md flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm">{group ? 'Edit Group' : 'New Group'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Group Name</label>
            <input
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Manager, Worker"
              autoFocus
              className="w-full px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Admin access */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.can_access_admin}
              onChange={e => setForm(prev => ({ ...prev, can_access_admin: e.target.checked }))}
              className="accent-primary w-4 h-4"
            />
            <div>
              <p className="text-sm font-medium">Can access Admin panel</p>
              <p className="text-xs text-muted-foreground">Allows managing users, groups, clients, and projects</p>
            </div>
          </label>

          {/* Module permissions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Allowed Apps</p>
              <div className="flex gap-2">
                <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">All</button>
                <span className="text-muted-foreground text-xs">·</span>
                <button type="button" onClick={selectNone} className="text-xs text-primary hover:underline">None</button>
              </div>
            </div>
            <div className="border border-border rounded-md divide-y divide-border">
              {ALL_MODULES.map(m => (
                <label
                  key={m.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                    form.allowed_modules.includes(m.id) ? 'bg-primary/10' : 'hover:bg-accent'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={form.allowed_modules.includes(m.id)}
                    onChange={() => toggleModule(m.id)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupsTab
// ---------------------------------------------------------------------------

export default function GroupsTab({ token }: { token: string }) {
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editGroup, setEditGroup] = useState<AdminGroup | null | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/admin/groups', { headers: authHeader(token) }).then(r => r.json())
      setGroups(data)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: number) => {
    await fetch(`/api/admin/groups/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    })
    setDeleteId(null)
    load()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Groups ({groups.length})</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Define roles and which apps each role can access</p>
        </div>
        <Button size="sm" onClick={() => setEditGroup(null)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Group
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Admin</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Allowed Apps</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map(g => (
                deleteId === g.id ? (
                  <tr key={g.id} className="bg-destructive/5">
                    <td colSpan={3} className="px-4 py-3 text-sm">
                      Delete group <strong>{g.name}</strong>? Users in this group will lose their role.
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(g.id)}>Delete</Button>
                        <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={g.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{g.name}</td>
                    <td className="px-4 py-3">
                      {g.can_access_admin ? (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Yes</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {g.allowed_modules.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : g.allowed_modules.length === ALL_MODULES.length ? (
                          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">All apps</span>
                        ) : (
                          g.allowed_modules.map(id => {
                            const label = ALL_MODULES.find(m => m.id === id)?.label ?? id
                            return (
                              <span key={id} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                {label}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEditGroup(g)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(g.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editGroup !== undefined && (
        <GroupDialog
          group={editGroup}
          token={token}
          onSave={() => { setEditGroup(undefined); load() }}
          onClose={() => setEditGroup(undefined)}
        />
      )}
    </div>
  )
}
