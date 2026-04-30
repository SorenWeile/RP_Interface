import { Plus } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { galleryModule, adminModule, comfyUIModule, type WorkflowModule } from '@/modules/index'
import { getIcon } from '@/lib/icons'
import MachineMonitor from './MachineMonitor'
import StorageStatus from './StorageStatus'
import type { ToolSummary } from '@/modules/workflow-builder/types'

interface Props {
  activeModule:    WorkflowModule | null
  activeToolId:    string | null
  wizardActive:    boolean
  onSelectModule:  (m: WorkflowModule) => void
  onOpenTool:      (id: string) => void
  onNewTool:       () => void
  showGallery:     boolean
  showComfyUI:     boolean
  showAdmin:       boolean
  workflowModules: WorkflowModule[]
  customTools:     ToolSummary[]
}

function NavButton({
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  label:    string
  icon?:    React.ComponentType<{ className?: string }>
  isActive: boolean
  onClick:  () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  )
}

export default function AppSidebar({
  activeModule, activeToolId, wizardActive,
  onSelectModule, onOpenTool, onNewTool,
  showGallery, showComfyUI, showAdmin,
  workflowModules, customTools,
}: Props) {
  return (
    <aside className="w-64 shrink-0 border-l border-border bg-card flex flex-col">
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Apps</p>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {/* Gallery */}
        {showGallery && (
          <NavButton
            label={galleryModule.title}
            icon={galleryModule.icon}
            isActive={activeModule?.id === galleryModule.id}
            onClick={() => onSelectModule(galleryModule)}
          />
        )}

        {/* ComfyUI */}
        {showComfyUI && (
          <NavButton
            label={comfyUIModule.title}
            icon={comfyUIModule.icon}
            isActive={activeModule?.id === comfyUIModule.id}
            onClick={() => onSelectModule(comfyUIModule)}
          />
        )}

        {/* Workflow Tools */}
        {workflowModules.length > 0 && (
          <>
            <div className="pt-1 pb-0.5">
              <p className="px-3 text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                Workflow Tools
              </p>
            </div>
            {workflowModules.map(m => (
              <NavButton
                key={m.id}
                label={m.title}
                icon={m.icon}
                isActive={activeModule?.id === m.id}
                onClick={() => onSelectModule(m)}
              />
            ))}
          </>
        )}

        {/* Custom Tools */}
        <div className="pt-1 pb-0.5">
          <p className="px-3 text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
            Custom Tools
          </p>
        </div>
        {customTools.map(t => {
          const Icon = getIcon(t.icon)
          return (
            <NavButton
              key={t.id}
              label={t.name}
              icon={Icon}
              isActive={activeToolId === t.id}
              onClick={() => onOpenTool(t.id)}
            />
          )
        })}
        <button
          onClick={onNewTool}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
            wizardActive
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          )}
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="truncate">New Tool</span>
        </button>

        {/* Admin */}
        {showAdmin && (
          <>
            <div className="pt-1 pb-0.5">
              <p className="px-3 text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                Settings
              </p>
            </div>
            <NavButton
              label={adminModule.title}
              icon={adminModule.icon}
              isActive={activeModule?.id === adminModule.id}
              onClick={() => onSelectModule(adminModule)}
            />
          </>
        )}
      </nav>

      <Separator />
      <StorageStatus />
      <Separator />
      <MachineMonitor />
    </aside>
  )
}
