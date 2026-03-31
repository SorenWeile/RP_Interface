import { useState, useEffect } from 'react'
import { ArrowLeft, LogOut } from 'lucide-react'
import { workflowModules, galleryModule, adminModule, type WorkflowModule } from '@/modules/index'
import ModuleGrid from '@/components/ModuleGrid'
import AppSidebar from '@/components/AppSidebar'
import LoginPage, { type AuthUser } from '@/components/LoginPage'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking')
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [active, setActive] = useState<WorkflowModule | null>(null)

  // Derive permissions from the logged-in user's group
  const isAdmin = currentUser?.is_admin ?? false
  const allowedIds: string[] = isAdmin
    ? [...workflowModules.map(m => m.id), 'gallery']
    : (currentUser?.group?.allowed_modules ?? [])
  const canAccessAdmin = isAdmin || (currentUser?.group?.can_access_admin ?? false)

  const visibleWorkflowModules = workflowModules.filter(m => allowedIds.includes(m.id))
  const showGallery = allowedIds.includes('gallery')
  const showAdmin  = canAccessAdmin

  // If the active module is no longer permitted, go back to hub
  const ActiveComponent = active?.component ?? null

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('user_token')
    if (!token) { setAuthState('unauthenticated'); return }
    fetch('/api/auth/me', { headers: { 'X-User-Token': token } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setCurrentUser(data.user); setAuthState('authenticated') })
      .catch(() => { localStorage.removeItem('user_token'); setAuthState('unauthenticated') })
  }, [])

  const handleLogin = (_token: string, user: AuthUser) => {
    setCurrentUser(user)
    setAuthState('authenticated')
  }

  const handleLogout = async () => {
    const token = localStorage.getItem('user_token')
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-User-Token': token },
      }).catch(() => {})
      localStorage.removeItem('user_token')
    }
    setCurrentUser(null)
    setActive(null)
    setAuthState('unauthenticated')
  }

  if (authState === 'checking') {
    return (
      <div className="h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => setActive(null)}
          className="flex items-center gap-3 hover:opacity-70 transition-opacity"
        >
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-foreground text-sm font-medium tracking-widest uppercase">
            ComfyUI Workflow UI
          </span>
        </button>

        <Button
          variant="outline"
          size="icon"
          onClick={() => setActive(null)}
          className={cn(
            'ml-auto transition-opacity',
            active ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          aria-label="Back to hub"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        {/* User info + logout */}
        <div className="flex items-center gap-2 ml-3">
          <span className="text-xs text-muted-foreground">{currentUser?.username}</span>
          <button
            onClick={handleLogout}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <main
          className={cn(
            'flex-1 overflow-hidden',
            active?.noPadding ? '' : 'overflow-y-auto p-8'
          )}
        >
          {ActiveComponent ? (
            active?.noPadding ? (
              /* Full-bleed modules (gallery) — fill the container exactly */
              <div className="h-full">
                <ActiveComponent />
              </div>
            ) : (
              <div className={active?.fullWidth ? undefined : 'max-w-2xl'}>
                <ActiveComponent />
              </div>
            )
          ) : (
            <ModuleGrid
              galleryModule={showGallery ? galleryModule : null}
              adminModule={showAdmin ? adminModule : null}
              workflowModules={visibleWorkflowModules}
              onSelect={setActive}
            />
          )}
        </main>

        {/* Right sidebar — hidden when a module hides it (e.g. gallery) */}
        {!active?.hidesSidebar && (
          <AppSidebar
            active={active}
            onSelect={setActive}
            showGallery={showGallery}
            showAdmin={showAdmin}
            workflowModules={visibleWorkflowModules}
          />
        )}
      </div>
    </div>
  )
}
