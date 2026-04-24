import { Images, Plus } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getIcon } from '@/lib/icons'
import type { WorkflowModule } from '@/modules/index'
import type { ToolSummary } from '@/modules/workflow-builder/types'

interface Props {
  galleryModule:    WorkflowModule | null
  adminModule:      WorkflowModule | null
  workflowModules:  WorkflowModule[]
  customTools:      ToolSummary[]
  onSelect:         (m: WorkflowModule) => void
  onOpenTool:       (toolId: string) => void
  onNewTool:        () => void
}

function ModuleCard({ m, onSelect }: { m: WorkflowModule; onSelect: (m: WorkflowModule) => void }) {
  const Icon = m.icon
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(m)}
      onKeyDown={e => e.key === 'Enter' && onSelect(m)}
      className="cursor-pointer border-border hover:border-primary/60 hover:bg-card/80 transition-colors"
    >
      <CardHeader>
        <div className="flex items-center gap-3 mb-1">
          {Icon && <Icon className="w-5 h-5 text-primary shrink-0" />}
          <CardTitle className="text-foreground">{m.title}</CardTitle>
        </div>
        <CardDescription>{m.description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function BigCard({ m, onSelect }: { m: WorkflowModule; onSelect: (m: WorkflowModule) => void }) {
  const Icon = m.icon ?? Images
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(m)}
      onKeyDown={e => e.key === 'Enter' && onSelect(m)}
      className="cursor-pointer border-border hover:border-primary/60 hover:bg-card/80 transition-colors"
    >
      <CardHeader>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-foreground text-xl">{m.title}</CardTitle>
            <CardDescription className="mt-1">{m.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

function CustomToolCard({ tool, onClick }: { tool: ToolSummary; onClick: () => void }) {
  const Icon = getIcon(tool.icon)
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className="cursor-pointer border-border hover:border-primary/60 hover:bg-card/80 transition-colors"
    >
      <CardHeader>
        <div className="flex items-center gap-3 mb-1">
          <Icon className="w-5 h-5 text-primary shrink-0" />
          <CardTitle className="text-foreground">{tool.name}</CardTitle>
        </div>
        <CardDescription>{tool.description || 'Custom tool'}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function NewToolCard({ onClick }: { onClick: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className="cursor-pointer border-dashed border-border hover:border-primary/60 hover:bg-card/80 transition-colors"
    >
      <CardHeader>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-5 h-5 rounded bg-muted flex items-center justify-center shrink-0">
            <Plus className="w-3 h-3 text-muted-foreground" />
          </div>
          <CardTitle className="text-muted-foreground font-normal">New Tool</CardTitle>
        </div>
        <CardDescription>Upload a workflow.json to build a UI</CardDescription>
      </CardHeader>
    </Card>
  )
}

export default function ModuleGrid({
  galleryModule, adminModule, workflowModules,
  customTools, onSelect, onOpenTool, onNewTool,
}: Props) {
  const hasAnyContent = galleryModule || workflowModules.length > 0 || adminModule
  if (!hasAnyContent) {
    return <p className="text-sm text-muted-foreground">No apps available for your account.</p>
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Gallery */}
      {galleryModule && (
        <>
          <div className="space-y-4">
            <div>
              <h2 className="text-foreground text-lg font-semibold tracking-wide">Gallery</h2>
              <p className="text-muted-foreground text-sm mt-1">Browse and manage your ComfyUI output images.</p>
            </div>
            <BigCard m={galleryModule} onSelect={onSelect} />
          </div>
          {(workflowModules.length > 0 || adminModule) && <div className="border-t border-border" />}
        </>
      )}

      {/* Workflow Tools */}
      {workflowModules.length > 0 && (
        <>
          <div className="space-y-4">
            <div>
              <h2 className="text-foreground text-lg font-semibold tracking-wide">Workflow Tools</h2>
              <p className="text-muted-foreground text-sm mt-1">Pick a ComfyUI workflow to run.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {workflowModules.map(m => (
                <ModuleCard key={m.id} m={m} onSelect={onSelect} />
              ))}
            </div>
          </div>
          <div className="border-t border-border" />
        </>
      )}

      {/* Custom Tools */}
      <div className="space-y-4">
        <div>
          <h2 className="text-foreground text-lg font-semibold tracking-wide">Custom Tools</h2>
          <p className="text-muted-foreground text-sm mt-1">Your saved tools, built from ComfyUI workflows.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {customTools.map(t => (
            <CustomToolCard key={t.id} tool={t} onClick={() => onOpenTool(t.id)} />
          ))}
          <NewToolCard onClick={onNewTool} />
        </div>
      </div>

      {/* Admin */}
      {adminModule && (
        <>
          <div className="border-t border-border" />
          <div className="space-y-4">
            <div>
              <h2 className="text-foreground text-lg font-semibold tracking-wide">Settings</h2>
              <p className="text-muted-foreground text-sm mt-1">Manage users, clients, and projects.</p>
            </div>
            <BigCard m={adminModule} onSelect={onSelect} />
          </div>
        </>
      )}
    </div>
  )
}
