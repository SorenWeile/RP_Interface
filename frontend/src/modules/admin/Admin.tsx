import { useState, useEffect } from 'react'
import { LogOut, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import UsersTab from './UsersTab'
import ClientsTab from './ClientsTab'
import ProjectsTab from './ProjectsTab'

const TOKEN_KEY = 'admin_token'

type Tab = 'users' | 'clients' | 'projects'

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid password' : 'Login failed')
        return
      }
      const data = await res.json()
      sessionStorage.setItem(TOKEN_KEY, data.token)
      onLogin(data.token)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Admin</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter admin password to continue</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Admin panel (authenticated)
// ---------------------------------------------------------------------------

function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('users')

  const logout = async () => {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
    }).catch(() => {})
    sessionStorage.removeItem(TOKEN_KEY)
    onLogout()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'clients', label: 'Clients' },
    { id: 'projects', label: 'Projects' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border flex items-center px-4 gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={logout}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 px-2"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'users' && <UsersTab token={token} />}
        {tab === 'clients' && <ClientsTab token={token} />}
        {tab === 'projects' && <ProjectsTab token={token} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root component — handles auth gate
// ---------------------------------------------------------------------------

export default function Admin() {
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Restore session from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY)
    if (!saved) {
      setChecking(false)
      return
    }
    fetch('/api/admin/me', { headers: { 'X-Admin-Token': saved } })
      .then(r => {
        if (r.ok) setToken(saved)
        else sessionStorage.removeItem(TOKEN_KEY)
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {token ? (
        <AdminPanel token={token} onLogout={() => setToken(null)} />
      ) : (
        <LoginForm onLogin={setToken} />
      )}
    </div>
  )
}
