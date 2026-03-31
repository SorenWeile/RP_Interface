import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { galleryModule, workflowModules, type WorkflowModule } from '@/modules/index'
import MachineMonitor from './MachineMonitor'

interface Props {
  active: WorkflowModule | null
  onSelect: (m: WorkflowModule) => void
}

function NavButton({
  m,
  active,
  onSelect,
}: {
  m: WorkflowModule
  active: WorkflowModule | null
  onSelect: (m: WorkflowModule) => void
}) {
  const Icon = m.icon
  const isActive = active?.id === m.id
  return (
    <button
      onClick={() => onSelect(m)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      <span className="truncate">{m.title}</span>
    </button>
  )
}

export default function AppSidebar({ active, onSelect }: Props) {
  return (
    <aside className="w-64 shrink-0 border-l border-border bg-card flex flex-col">
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Apps</p>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {/* Gallery — top entry */}
        <NavButton m={galleryModule} active={active} onSelect={onSelect} />

        <div className="pt-1 pb-0.5">
          <p className="px-3 text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
            Workflow Tools
          </p>
        </div>

        {/* Workflow modules */}
        {workflowModules.map(m => (
          <NavButton key={m.id} m={m} active={active} onSelect={onSelect} />
        ))}
      </nav>

      <Separator />
      <MachineMonitor />
    </aside>
  )
}
