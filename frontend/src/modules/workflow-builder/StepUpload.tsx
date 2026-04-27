import { useRef, useMemo, useState } from 'react'
import { Upload, Check, X, FileJson, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { detectInputs } from './detect'
import type { DetectedInput } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function badgeClass(t: DetectedInput['detected_type']): string {
  if (t === 'auto_seed')   return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (t === 'output_path') return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  if (t === 'image')       return 'bg-primary/10 text-primary border-primary/20'
  return 'bg-muted/40 text-muted-foreground border-border'
}

function badgeLabel(t: DetectedInput['detected_type']): string {
  const map: Record<string, string> = {
    auto_seed:   'Auto · seed',
    auto_user:   'Auto · user',
    output_path: 'Output Path',
    image:       'Image',
    text:        'Text',
    textarea:    'Textarea',
    number:      'Number',
    slider:      'Slider',
    select:      'Select',
    toggle:      'Toggle',
  }
  return map[t] ?? t
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  workflowJson:        Record<string, unknown> | null
  setWorkflowJson:     (v: Record<string, unknown> | null) => void
  fileName:            string
  setFileName:         (v: string) => void
  detected:            DetectedInput[]
  setDetected:         (v: DetectedInput[]) => void
  selectedNodeKeys:    Set<string>
  setSelectedNodeKeys: (v: Set<string>) => void
  imageDefaultKeys:    Set<string>
  setImageDefaultKeys: (v: Set<string>) => void
  onNext:              () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StepUpload({
  workflowJson, setWorkflowJson, fileName, setFileName,
  detected, setDetected,
  selectedNodeKeys, setSelectedNodeKeys,
  imageDefaultKeys, setImageDefaultKeys,
  onNext,
}: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [error,    setError]    = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    setError('')
    if (!file.name.endsWith('.json')) { setError('Please upload a .json file.'); return }
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string) as Record<string, unknown>
        const det = detectInputs(parsed)
        if (det.length === 0) {
          setError('No configurable inputs found. Make sure this was exported in ComfyUI API format.')
          return
        }
        setWorkflowJson(parsed)
        setFileName(file.name)
        setDetected(det)
        // Pre-select image inputs; all others start unchecked (auto rows never selectable)
        const imageKeys = new Set(
          det
            .filter(d => d.detected_type === 'image')
            .map(d => `${d.node_id}:${d.input_key}`)
        )
        setSelectedNodeKeys(imageKeys)
        // Pre-tick example.png default for every image input
        setImageDefaultKeys(new Set(imageKeys))
      } catch {
        setError('Invalid JSON file.')
      }
    }
    reader.readAsText(file)
  }

  const clearFile = () => {
    setWorkflowJson(null)
    setFileName('')
    setDetected([])
    setError('')
    setSelectedNodeKeys(new Set())
    setImageDefaultKeys(new Set())
  }

  const toggleSelect = (key: string) => {
    const next = new Set(selectedNodeKeys)
    if (next.has(key)) {
      next.delete(key)
      // Deselecting an image also removes its default
      const nextDef = new Set(imageDefaultKeys)
      nextDef.delete(key)
      setImageDefaultKeys(nextDef)
    } else {
      next.add(key)
    }
    setSelectedNodeKeys(next)
  }

  const toggleImageDefault = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(imageDefaultKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setImageDefaultKeys(next)
  }

  const nodeCount  = workflowJson ? Object.keys(workflowJson).length : 0
  const wiredCount = useMemo(() => {
    if (!workflowJson) return 0
    let n = 0
    for (const node of Object.values(workflowJson)) {
      const inputs = (node as Record<string, unknown>)?.inputs as Record<string, unknown> | undefined
      if (!inputs) continue
      for (const v of Object.values(inputs)) if (Array.isArray(v)) n++
    }
    return n
  }, [workflowJson])

  return (
    <div className="flex flex-col h-full gap-5 min-h-0">
      <div className="shrink-0">
        <h2 className="text-lg font-medium text-foreground">Upload Workflow</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drop a ComfyUI workflow exported in API format. Parsing happens in your browser.
        </p>
      </div>

      {!workflowJson ? (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          <div
            className={cn(
              'border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-12 cursor-pointer transition-colors select-none',
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-card/60',
            )}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-foreground font-medium">Drop workflow.json here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse (.json only)</p>
            <input
              ref={inputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <>
          {/* Parse summary */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 rounded-md border border-green-500/30 bg-green-500/5">
            <Check className="w-4 h-4 text-green-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-muted-foreground" />
                {fileName}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {nodeCount} nodes · {detected.length} configurable inputs · {wiredCount} wired connections hidden
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFile} className="shrink-0">
              <X className="w-3.5 h-3.5 mr-1" /> Replace
            </Button>
          </div>

          {/* Selection hint */}
          <p className="shrink-0 text-xs text-muted-foreground">
            Check the inputs you want to expose as fields.{' '}
            <span className="text-foreground font-medium">{selectedNodeKeys.size} selected.</span>{' '}
            Seed and output-path rows are auto-handled and locked.
            The{' '}
            <ImageIcon className="inline w-3 h-3 relative -top-px" />{' '}
            toggle marks an image field as optional with{' '}
            <code className="text-[10px] bg-muted px-1 rounded">example.png</code> as its default.
          </p>

          {/* Inspection table — grows to fill remaining height */}
          <div className="flex-1 min-h-0 rounded-md border border-border overflow-x-auto overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 w-8" />
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium w-14">Node</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Title</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden md:table-cell">Class</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Input</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden lg:table-cell">Current value</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium w-28">Type</th>
                  <th className="px-3 py-2 w-10 text-center hidden sm:table-cell" title="Use example.png as default for image fields">
                    <ImageIcon className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detected.map(d => {
                  const key      = `${d.node_id}:${d.input_key}`
                  const isAuto   = d.detected_type === 'auto_seed' || d.detected_type === 'output_path'
                  const isImage  = d.detected_type === 'image'
                  const isSel    = selectedNodeKeys.has(key)
                  const hasDef   = imageDefaultKeys.has(key)
                  const valStr   = typeof d.current_value === 'string'
                    ? (d.current_value.length > 45 ? d.current_value.slice(0, 45) + '…' : d.current_value || '(empty)')
                    : String(d.current_value)

                  return (
                    <tr
                      key={key}
                      className={cn(
                        'transition-colors',
                        isAuto          ? 'opacity-40' :
                        isSel           ? 'bg-primary/5 hover:bg-primary/10' :
                                          'opacity-60 hover:opacity-80 hover:bg-muted/20',
                        !isAuto && 'cursor-pointer',
                      )}
                      onClick={!isAuto ? () => toggleSelect(key) : undefined}
                    >
                      {/* Checkbox */}
                      <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                        {!isAuto && (
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSelect(key)}
                            className="w-3.5 h-3.5 accent-primary"
                          />
                        )}
                      </td>

                      <td className="px-3 py-2 font-mono text-muted-foreground">{d.node_id}</td>
                      <td className="px-3 py-2 text-foreground">{d.title}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground hidden md:table-cell">{d.class_type}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground hidden sm:table-cell">{d.input_key}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground hidden lg:table-cell max-w-[200px] truncate">{valStr}</td>

                      <td className="px-3 py-2">
                        <span className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border',
                          badgeClass(d.detected_type),
                        )}>
                          {badgeLabel(d.detected_type)}
                        </span>
                      </td>

                      {/* example.png default toggle — image rows only */}
                      <td className="px-3 py-2 text-center hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                        {isImage && isSel && (
                          <input
                            type="checkbox"
                            checked={hasDef}
                            onChange={() => {}}
                            onClick={e => toggleImageDefault(key, e)}
                            className="w-3 h-3 accent-primary cursor-pointer"
                            title="Use example.png as default (ComfyUI ships this file)"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="shrink-0 flex justify-end">
            <Button onClick={onNext} disabled={selectedNodeKeys.size === 0}>
              Next <span className="ml-1">→</span>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
