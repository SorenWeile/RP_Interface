import { useState } from 'react'
import { ArrowLeft, Images } from 'lucide-react'
import { modules, type WorkflowModule } from '@/modules/index'
import ModuleGrid from '@/components/ModuleGrid'
import AppSidebar from '@/components/AppSidebar'
import { Button } from '@/components/ui/button'

function getGalleryUrl(): string {
  const href = window.location.href
  const match = href.match(/(https:\/\/[^-]+-)\d+(\.proxy\.runpod\.net)/)
  if (match) return `${match[1]}3002${match[2]}`
  return 'http://localhost:3002'
}

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

        <a href={getGalleryUrl()} target="_blank" rel="noopener noreferrer" className="ml-auto">
          <Button variant="outline" size="sm" className="gap-2">
            <Images className="w-4 h-4" />
            Gallery
          </Button>
        </a>

        <Button
          variant="outline"
          size="icon"
          onClick={() => setActive(null)}
          className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-label="Back to grid"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className={active?.fullWidth ? undefined : 'max-w-2xl'}>
            {ActiveComponent
              ? <ActiveComponent />
              : <ModuleGrid modules={modules} onSelect={setActive} />
            }
          </div>
        </main>

        {/* Right sidebar — always visible */}
        <AppSidebar modules={modules} active={active} onSelect={setActive} />
      </div>
    </div>
  )
}
