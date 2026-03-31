import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AdminClient } from './types'

const authHeader = (token: string) => ({ 'X-Admin-Token': token, 'Content-Type': 'application/json' })

function InlineForm({
  initial,
  onSave,
  onCancel,
  token,
  editId,
}: {
  initial?: AdminClient
  onSave: () => void
  onCancel: () => void
  token: string
  editId: number | null
}) {
  const [clientId, setClientId] = useState(initial?.client_id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientId.trim()) { setError('Client ID required'); return }
    setError('')
    setSaving(true)
    try {
      const url = editId != null ? `/api/admin/clients/${editId}` : '/api/admin/clients'
      const method = editId != null ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeader(token),
        body: JSON.stringify({ client_id: clientId.trim(), name: name.trim() }),
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
    <form onSubmit={submit} className="flex items-start gap-2">
      <div className="flex-1 grid grid-cols-2 gap-2">
        <input
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="Client ID (e.g. Deployed/HD)"
          autoFocus
          className="px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Display name"
          className="px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      {error && <span className="text-xs text-destructive self-center">{error}</span>}
      <button
        type="submit"
        disabled={saving}
        className="p-2 rounded text-primary hover:bg-primary/10 transition-colors"
        title="Save"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Cancel"
      >
        <X className="w-4 h-4" />
      </button>
    </form>
  )
}

export default function ClientsTab({ token }: { token: string }) {
  const [clients, setClients] = useState<AdminClient[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/admin/clients', { headers: authHeader(token) }).then(r => r.json())
      setClients(data)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: number) => {
    await fetch(`/api/admin/clients/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token },
    })
    setDeleteId(null)
    load()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Clients ({clients.length})</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Client IDs used as output path prefixes (e.g. <code className="font-mono">Deployed/HD</code>)</p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => { setAdding(true); setEditId(null) }}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Client
          </Button>
        )}
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-3 bg-muted/20">
          <InlineForm
            token={token}
            editId={null}
            onSave={() => { setAdding(false); load() }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {clients.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Client ID</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Display Name</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map(c => (
                editId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={3} className="px-4 py-3">
                      <InlineForm
                        initial={c}
                        token={token}
                        editId={c.id}
                        onSave={() => { setEditId(null); load() }}
                        onCancel={() => setEditId(null)}
                      />
                    </td>
                  </tr>
                ) : deleteId === c.id ? (
                  <tr key={c.id} className="bg-destructive/5">
                    <td colSpan={2} className="px-4 py-3 text-sm">
                      Delete <strong>{c.name}</strong>?
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(c.id)}>Delete</Button>
                        <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{c.client_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => { setEditId(c.id); setAdding(false) }}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
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
    </div>
  )
}
