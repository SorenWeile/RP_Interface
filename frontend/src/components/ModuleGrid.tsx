import { Images } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { WorkflowModule } from '@/modules/index'

interface Props {
  galleryModule: WorkflowModule
  workflowModules: WorkflowModule[]
  onSelect: (m: WorkflowModule) => void
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

export default function ModuleGrid({ galleryModule, workflowModules, onSelect }: Props) {
  const GalleryIcon = galleryModule.icon ?? Images

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Gallery section — prominent single card */}
      <div className="space-y-4">
        <div>
          <h2 className="text-foreground text-lg font-semibold tracking-wide">Gallery</h2>
          <p className="text-muted-foreground text-sm mt-1">Browse and manage your ComfyUI output images.</p>
        </div>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => onSelect(galleryModule)}
          onKeyDown={e => e.key === 'Enter' && onSelect(galleryModule)}
          className="cursor-pointer border-border hover:border-primary/60 hover:bg-card/80 transition-colors"
        >
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <GalleryIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-foreground text-xl">{galleryModule.title}</CardTitle>
                <CardDescription className="mt-1">{galleryModule.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Workflow Tools section */}
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
    </div>
  )
}
