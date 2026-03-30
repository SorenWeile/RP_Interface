import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { WorkflowModule } from '@/modules/index'
import MachineMonitor from './MachineMonitor'

interface Props {
  modules: WorkflowModule[]
  active: WorkflowModule | null
  onSelect: (m: WorkflowModule) => void
}

export default function AppSidebar({ modules, active, onSelect }: Props) {
  return (
    <aside className="w-52 shrink-0 border-l border-border bg-card flex flex-col">
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
          Apps
        </p>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {modules.map((m) => {
          const Icon = m.icon
          const isActive = active?.id === m.id
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {Icon && <Icon className="w-4 h-4 shrink-0" />}
              <span className="truncate">{m.title}</span>
            </button>
          )
        })}
      </nav>

      <Separator />
      <MachineMonitor />
    </aside>
  )
}
