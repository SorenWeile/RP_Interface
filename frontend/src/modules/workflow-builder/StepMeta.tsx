import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getIcon, ICON_LIBRARY } from '@/lib/icons'
import type { FieldDef } from './types'

interface Props {
  toolName:     string
  setToolName:  (v: string) => void
  toolDesc:     string
  setToolDesc:  (v: string) => void
  toolIcon:     string
  setToolIcon:  (v: string) => void
  fields:       FieldDef[]
  hasPathNode:  boolean
  onBack:       () => void
  onSave:       () => void
  saving:       boolean
}

export default function StepMeta({
  toolName, setToolName,
  toolDesc, setToolDesc,
  toolIcon, setToolIcon,
  fields, hasPathNode,
  onBack, onSave, saving,
}: Props) {
  const [nameErr, setNameErr] = useState('')

  const handleSave = () => {
    if (!toolName.trim()) { setNameErr('Tool name is required.'); return }
    onSave()
  }

  const SelectedIcon = getIcon(toolIcon)

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-lg font-medium text-foreground">Name your tool</h2>
        <p className="text-xs text-muted-foreground mt-1">
          The tool will appear in the sidebar and hub after saving.
        </p>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">
          Tool name <span className="text-destructive">*</span>
        </label>
        <Input
          value={toolName}
          onChange={e => { setToolName(e.target.value); setNameErr('') }}
          placeholder="Portrait Generator"
          className={nameErr ? 'border-destructive' : ''}
        />
        {nameErr && <p className="text-xs text-destructive">{nameErr}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Short description</label>
        <textarea
          value={toolDesc}
          onChange={e => setToolDesc(e.target.value)}
          rows={2}
          placeholder="Generate a portrait from a reference photo…"
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Icon picker */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Icon</label>
        <div className="grid grid-cols-8 gap-1.5 p-3 rounded-md border border-border bg-card max-h-48 overflow-y-auto">
          {ICON_LIBRARY.map(name => {
            const Ic = getIcon(name)
            return (
              <button
                key={name}
                title={name}
                onClick={() => setToolIcon(name)}
                className={cn(
                  'aspect-square flex items-center justify-center rounded border transition-colors',
                  toolIcon === name
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <Ic className="w-4 h-4" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Tile preview */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Preview tile</label>
        <div className="inline-flex items-start gap-3 p-4 rounded-md border border-border bg-card max-w-sm">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <SelectedIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{toolName || 'Untitled Tool'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {toolDesc || 'Short description appears here.'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5">
              {fields.length} field{fields.length !== 1 ? 's' : ''}
              {hasPathNode ? ' · client/project picker' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>← Back</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Tool'}
        </Button>
      </div>
    </div>
  )
}
