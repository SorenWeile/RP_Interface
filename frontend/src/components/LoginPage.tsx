import { useState } from 'react'
import { Button } from '@/components/ui/button'

export interface AuthUser {
  id: number
  username: string
  email: string
  is_admin: boolean
  group: {
    id: number
    name: string
    can_access_admin: boolean
    allowed_modules: string[]
  } | null
  clients: { id: number; client_id: string; name: string }[]
  projects: { id: number; project_id: string; name: string }[]
}

interface Props {
  onLogin: (token: string, user: AuthUser) => void
}

export default function LoginPage({ onLogin }: Props) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid username or password' : 'Login failed')
        return
      }
      const data = await res.json()
      localStorage.setItem('user_token', data.token)
      onLogin(data.token, data.user)
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-background flex flex-col items-center justify-center">
      <div className="w-full max-w-sm space-y-8 px-4">
        {/* Logo / title */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <div className="text-center">
            <h1 className="text-foreground text-lg font-medium tracking-widest uppercase">
              ComfyUI Workflow UI
            </h1>
            <p className="text-muted-foreground text-sm mt-2">Sign in to continue</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-3">
          <input
            type="text"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder="Username or email"
            autoFocus
            required
            className="w-full px-4 py-2.5 rounded-md border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full px-4 py-2.5 rounded-md border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />

          {error && (
            <p className="text-xs text-destructive pt-1">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full mt-1"
            disabled={loading || !identifier || !password}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
