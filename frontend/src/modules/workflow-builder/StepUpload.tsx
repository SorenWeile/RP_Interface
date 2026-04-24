import { useRef, useState, useMemo } from 'react'
import { Upload, Check, X, FileJson } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { detectInputs } from './detect'
import type { DetectedInput } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function badgeClass(t: DetectedInput['detected_type']): string {
  if (t === 'auto_seed') return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (t === 'auto_user') return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  if (t === 'output_path') return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  return 'bg-primary/10 text-primary border-primary/20'
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
  workflowJson:    Record<string, unknown> | null
  setWorkflowJson: (v: Record<string, unknown> | null) => void
  fileName:        string
  setFileName:     (v: string) => void
  detected:        DetectedInput[]
  setDetected:     (v: DetectedInput[]) => void
  onNext:          () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StepUpload({
  workflowJson, setWorkflowJson, fileName, setFileName, detected, setDetected, onNext,
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
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-medium text-foreground">Upload Workflow</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drop a ComfyUI workflow exported in API format. Parsing happens in your browser.
        </p>
      </div>

      {!workflowJson ? (
        <>
          {/* Drop zone */}
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
        </>
      ) : (
        <>
          {/* Parse summary */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-md border border-green-500/30 bg-green-500/5">
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

          {/* Inspection table */}
          <div className="rounded-md border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium w-14">Node</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Title</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden md:table-cell">Class</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Input</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden lg:table-cell">Current value</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium w-32">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detected.map(d => {
                    const isAuto = d.detected_type === 'auto_seed' || d.detected_type === 'auto_user'
                    const valStr = typeof d.current_value === 'string'
                      ? (d.current_value.length > 45 ? d.current_value.slice(0, 45) + '…' : d.current_value || '(empty)')
                      : String(d.current_value)
                    return (
                      <tr
                        key={`${d.node_id}:${d.input_key}`}
                        className={isAuto ? 'opacity-40' : undefined}
                      >
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={onNext}>
              Next <span className="ml-1">→</span>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
