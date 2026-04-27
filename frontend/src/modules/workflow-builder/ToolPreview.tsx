import ClientProjectPicker from '@/components/ClientProjectPicker'
import FieldRenderer from '@/modules/custom-tool/FieldRenderer'
import { groupFields } from './detect'
import type { FieldDef } from './types'

interface Props {
  fields: FieldDef[]
  hasPathNode: boolean
  toolName?: string
  toolDesc?: string
}

export default function ToolPreview({ fields, hasPathNode, toolName, toolDesc }: Props) {
  return (
    <div className="sticky top-0 rounded-md border border-border overflow-hidden">
      {/* Chrome bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
          Live Preview · Disabled
        </span>
        <span className="text-[10px] text-primary">
          {fields.length} field{fields.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4 bg-background overflow-y-auto max-h-[calc(100vh-220px)]">
        {/* Tool header */}
        {toolName && (
          <div className="mb-2">
            <div className="text-sm font-medium text-foreground">{toolName}</div>
            {toolDesc && <div className="text-xs text-muted-foreground mt-0.5">{toolDesc}</div>}
          </div>
        )}

        {fields.length === 0 && (
          <div className="text-xs text-muted-foreground text-center border border-dashed border-border rounded py-8">
            No fields yet. Add fields from the left column.
          </div>
        )}

        {groupFields(fields).map((grp, i) => (
          <div key={i} className={grp.length > 1 ? 'flex gap-2' : undefined}>
            {grp.map(f => (
              <div key={f.id} className={`space-y-1.5${grp.length > 1 ? ' flex-1 min-w-0' : ''}`}>
                <label className="text-xs text-muted-foreground uppercase tracking-widest">
                  {f.label}
                  {f.required && <span className="text-destructive ml-1">*</span>}
                </label>
                <FieldRenderer
                  field={f}
                  value={f.default}
                  onChange={() => {}}
                  disabled
                />
              </div>
            ))}
          </div>
        ))}

        {hasPathNode && (
          <>
            <div className="border-t border-border" />
            <ClientProjectPicker
              clientPath=""
              productPath=""
              filePrefix="Shot001"
              onClientPath={() => {}}
              onProductPath={() => {}}
              onFilePrefix={() => {}}
              disabled
            />
          </>
        )}

        {fields.length > 0 && (
          <button
            className="w-full py-2 text-sm rounded-md bg-primary/60 text-primary-foreground opacity-60 cursor-not-allowed mt-2"
            disabled
          >
            Run
          </button>
        )}
      </div>
    </div>
  )
}
