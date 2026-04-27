import { useEffect, useState, useCallback } from 'react'
import { ArrowLeft, LogOut } from 'lucide-react'
import { workflowModules, galleryModule, adminModule, type WorkflowModule } from '@/modules/index'
import ModuleGrid from '@/components/ModuleGrid'
import AppSidebar from '@/components/AppSidebar'
import LoginPage, { type AuthUser } from '@/components/LoginPage'
import { ToastProvider } from '@/components/Toaster'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { listTools } from '@/api/client'
import WorkflowBuilder from '@/modules/workflow-builder/WorkflowBuilder'
import CustomTool from '@/modules/custom-tool/CustomTool'
import type { ToolSummary } from '@/modules/workflow-builder/types'

// ── Navigation state ──────────────────────────────────────────────────────────

type NavState =
  | { screen: 'hub' }
  | { screen: 'module';  module: WorkflowModule }
  | { screen: 'wizard';  editToolId?: string }
  | { screen: 'tool';    toolId: string }

export default function App() {
  const [authState, setAuthState]   = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking')
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [nav, setNav]               = useState<NavState>({ screen: 'hub' })
  const [customTools, setCustomTools] = useState<ToolSummary[]>([])

  // Derive permissions from the logged-in user's group
  const isAdmin = currentUser?.is_admin ?? false
  const allowedIds: string[] = isAdmin
    ? [...workflowModules.map(m => m.id), 'gallery']
    : (currentUser?.group?.allowed_modules ?? [])
  const canAccessAdmin = isAdmin || (currentUser?.group?.can_access_admin ?? false)

  const visibleWorkflowModules = workflowModules.filter(m => allowedIds.includes(m.id))
  const showGallery = allowedIds.includes('gallery')
  const showAdmin   = canAccessAdmin

  // Load custom tools from the API
  const refreshCustomTools = useCallback(() => {
    listTools()
      .then(all => setCustomTools(all.filter(t => !t.is_builtin)))
      .catch(() => {})
  }, [])

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('user_token')
    if (!token) { setAuthState('unauthenticated'); return }
    fetch('/api/auth/me', { headers: { 'X-User-Token': token } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setCurrentUser(data.user); setAuthState('authenticated') })
      .catch(() => { localStorage.removeItem('user_token'); setAuthState('unauthenticated') })
  }, [])

  // Load tools once authenticated
  useEffect(() => {
    if (authState === 'authenticated') refreshCustomTools()
  }, [authState, refreshCustomTools])

  // Refresh when admin panel deletes a tool
  useEffect(() => {
    window.addEventListener('rp:tools-changed', refreshCustomTools)
    return () => window.removeEventListener('rp:tools-changed', refreshCustomTools)
  }, [refreshCustomTools])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const openHub    = () => setNav({ screen: 'hub' })
  const openModule = (m: WorkflowModule) => setNav({ screen: 'module', module: m })
  const openTool   = (toolId: string) => setNav({ screen: 'tool', toolId })
  const openWizard = (editToolId?: string) => setNav({ screen: 'wizard', editToolId })

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
    setNav({ screen: 'hub' })
    setAuthState('unauthenticated')
  }

  const handleWizardSave = (toolId: string) => {
    refreshCustomTools()
    openTool(toolId)
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeModule = nav.screen === 'module' ? nav.module : null

  const hidesSidebar = nav.screen === 'module' && nav.module.hidesSidebar
  const noPadding    = nav.screen === 'module' && nav.module.noPadding
  const fullWidth    = nav.screen === 'module' && nav.module.fullWidth
  const isWizard     = nav.screen === 'wizard'
  const showBackBtn  = nav.screen !== 'hub'

  // ── Auth gates ────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ToastProvider>
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card px-6 py-3 flex items-center gap-3">
        <button
          onClick={openHub}
          className="flex items-center gap-3 hover:opacity-70 transition-opacity"
        >
          <img src="./ai_toolhouse.png" alt="" className="w-5 h-5 object-contain" />
          <span className="text-foreground text-sm font-medium tracking-widest uppercase">
            AI Toolhouse
          </span>
        </button>

        <Button
          variant="outline"
          size="icon"
          onClick={openHub}
          className={cn(
            'ml-auto transition-opacity',
            showBackBtn ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
            !noPadding && 'p-8',
            !noPadding && !isWizard && 'overflow-y-auto',
            isWizard && 'flex flex-col min-h-0',
          )}
        >
          {/* Hub */}
          {nav.screen === 'hub' && (
            <ModuleGrid
              galleryModule={showGallery ? galleryModule : null}
              adminModule={showAdmin ? adminModule : null}
              workflowModules={visibleWorkflowModules}
              customTools={customTools}
              onSelect={openModule}
              onOpenTool={openTool}
              onNewTool={() => openWizard()}
            />
          )}

          {/* Built-in module */}
          {nav.screen === 'module' && (
            noPadding ? (
              <div className="h-full">
                <nav.module.component />
              </div>
            ) : (
              <div className={fullWidth ? undefined : 'max-w-2xl'}>
                <nav.module.component />
              </div>
            )
          )}

          {/* Workflow Builder wizard */}
          {nav.screen === 'wizard' && (
            <div className="max-w-4xl flex-1 flex flex-col min-h-0">
              <WorkflowBuilder
                editToolId={nav.editToolId}
                onSave={handleWizardSave}
                onDiscard={openHub}
              />
            </div>
          )}

          {/* Custom tool runner */}
          {nav.screen === 'tool' && (
            <div className="max-w-2xl">
              <CustomTool
                toolId={nav.toolId}
                onEdit={() => openWizard(nav.toolId)}
                onDelete={() => {
                  refreshCustomTools()
                  openHub()
                }}
              />
            </div>
          )}
        </main>

        {/* Right sidebar */}
        {!hidesSidebar && (
          <AppSidebar
            activeModule={activeModule}
            activeToolId={nav.screen === 'tool' ? nav.toolId : null}
            wizardActive={nav.screen === 'wizard'}
            onSelectModule={openModule}
            onOpenTool={openTool}
            onNewTool={() => openWizard()}
            showGallery={showGallery}
            showAdmin={showAdmin}
            workflowModules={visibleWorkflowModules}
            customTools={customTools}
          />
        )}
      </div>
    </div>
    </ToastProvider>
  )
}
