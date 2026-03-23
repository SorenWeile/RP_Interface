import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { WorkflowModule } from '@/modules/index'

interface Props {
  modules: WorkflowModule[]
  onSelect: (m: WorkflowModule) => void
}

export default function ModuleGrid({ modules, onSelect }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold tracking-wide">Workflows</h2>
        <p className="text-muted-foreground text-sm mt-1">Pick a tool to get started.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => {
          const Icon = m.icon
          return (
            <Card
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(m)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(m)}
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
        })}
      </div>
    </div>
  )
}
