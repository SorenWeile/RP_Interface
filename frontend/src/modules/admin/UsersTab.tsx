import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AdminUser, AdminClient, AdminProject } from './types'

const authHeader = (token: string) => ({ 'X-Admin-Token': token, 'Content-Type': 'application/json' })

interface FormState {
  username: string
  email: string
  password: string
  client_ids: number[]
  project_ids: number[]
}

const emptyForm = (): FormState => ({
  username: '',
  email: '',
  password: '',
  client_ids: [],
  project_ids: [],
})

// ---------------------------------------------------------------------------
// Multi-checkbox picker
// ---------------------------------------------------------------------------

function CheckPicker<T extends { id: number; name: string }>({
  label,
  items,
  selected,
  onChange,
}: {
  label: string
  items: T[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">None defined yet</p>
      ) : (
        <div className="max-h-36 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {items.map(item => (
            <label
              key={item.id}
              className={cn(
                'flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-sm transition-colors',
                selected.includes(item.id) ? 'bg-primary/10' : 'hover:bg-accent'
              )}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
                className="accent-primary"
              />
              <span className="flex-1">{item.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// User form dialog
// ---------------------------------------------------------------------------

function UserDialog({
  user,
  clients,
  projects,
  token,
  onSave,
  onClose,
}: {
  user: AdminUser | null
  clients: AdminClient[]
  projects: AdminProject[]
  token: string
  onSave: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() =>
    user
      ? {
          username: user.username,
          email: user.email,
          password: '',
          client_ids: user.clients.map(c => c.id),
          project_ids: user.projects.map(p => p.id),
        }
      : emptyForm()
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormState, v: string | number[]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        username: form.username,
        email: form.email,
        client_ids: form.client_ids,
        project_ids: form.project_ids,
      }
      if (!user || form.password) body.password = form.password

      const url = user ? `/api/admin/users/${user.id}` : '/api/admin/users'
      const method = user ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeader(token),
        body: JSON.stringify(body),
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
      <div className="bg-card border border-border rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm">{user ? 'Edit User' : 'New User'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Username</label>
              <input
                value={form.username}
                onChange={e => set('username', e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Password {user && <span className="font-normal">(leave blank to keep current)</span>}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              required={!user}
              placeholder={user ? '••••••••' : ''}
              className="w-full px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <CheckPicker
            label="Clients"
            items={clients}
            selected={form.client_ids}
            onChange={ids => set('client_ids', ids)}
          />

          <CheckPicker
            label="Projects"
            items={projects}
            selected={form.project_ids}
            onChange={ids => set('project_ids', ids)}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
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
// Delete confirm
// ---------------------------------------------------------------------------

function DeleteConfirm({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-xl space-y-4">
        <p className="text-sm text-foreground">
          Delete user <strong>{name}</strong>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UsersTab
// ---------------------------------------------------------------------------

export default function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [clients, setClients] = useState<AdminClient[]>([])
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [loading, setLoading] = useState(true)
  const [editUser, setEditUser] = useState<AdminUser | null | undefined>(undefined) // undefined=closed, null=new
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, c, p] = await Promise.all([
        fetch('/api/admin/users', { headers: authHeader(token) }).then(r => r.json()),
        fetch('/api/admin/clients', { headers: authHeader(token) }).then(r => r.json()),
        fetch('/api/admin/projects', { headers: authHeader(token) }).then(r => r.json()),
      ])
      setUsers(u)
      setClients(c)
      setProjects(p)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleDelete = async () => {
    if (!deleteUser) return
    await fetch(`/api/admin/users/${deleteUser.id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    })
    setDeleteUser(null)
    load()
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Users ({users.length})</h2>
        <Button size="sm" onClick={() => setEditUser(null)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New User
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Username</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Clients</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Projects</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.clients.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        u.clients.map(c => (
                          <span key={c.id} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {c.name}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.projects.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        u.projects.map(p => (
                          <span key={p.id} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {p.name}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditUser(u)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteUser(u)}
                        className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editUser !== undefined && (
        <UserDialog
          user={editUser}
          clients={clients}
          projects={projects}
          token={token}
          onSave={() => { setEditUser(undefined); load() }}
          onClose={() => setEditUser(undefined)}
        />
      )}

      {deleteUser && (
        <DeleteConfirm
          name={deleteUser.username}
          onConfirm={handleDelete}
          onCancel={() => setDeleteUser(null)}
        />
      )}
    </div>
  )
}
