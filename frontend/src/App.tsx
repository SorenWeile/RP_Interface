import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { workflowModules, galleryModule, type WorkflowModule } from '@/modules/index'
import ModuleGrid from '@/components/ModuleGrid'
import AppSidebar from '@/components/AppSidebar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function App() {
  const [active, setActive] = useState<WorkflowModule | null>(null)
  const ActiveComponent = active?.component ?? null

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
              galleryModule={galleryModule}
              workflowModules={workflowModules}
              onSelect={setActive}
            />
          )}
        </main>

        {/* Right sidebar — hidden when a module hides it (e.g. gallery) */}
        {!active?.hidesSidebar && (
          <AppSidebar active={active} onSelect={setActive} />
        )}
      </div>
    </div>
  )
}
