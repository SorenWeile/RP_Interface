import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createTool, getTool, updateTool } from '@/api/client'
import { buildFieldDef, detectInputs, detectOutputPathNodes } from './detect'
import Stepper from './Stepper'
import StepUpload from './StepUpload'
import StepFields from './StepFields'
import StepMeta from './StepMeta'
import type { DetectedInput, FieldDef, ToolDef } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveAutoNodes(detected: DetectedInput[], fields: FieldDef[]) {
  const nodes: Array<{ node_id: string; input_key: string; strategy: string }> = []
  // Seed auto-injection comes from detected inputs
  for (const d of detected) {
    if (d.detected_type === 'auto_seed') {
      nodes.push({ node_id: d.node_id, input_key: d.input_key, strategy: 'random_seed' })
    }
  }
  // Username injection comes from fields explicitly typed 'user'
  for (const f of fields) {
    if (f.type === 'user') {
      nodes.push({ node_id: f.node_id, input_key: f.input_key, strategy: 'username' })
    }
  }
  return nodes
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** If set, we're editing an existing tool (skip to step 2). */
  editToolId?: string
  onSave:      (toolId: string) => void
  onDiscard:   () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkflowBuilder({ editToolId, onSave, onDiscard }: Props) {
  const [step,             setStep]             = useState<1 | 2 | 3>(editToolId ? 2 : 1)
  const [workflowJson,     setWorkflowJson]     = useState<Record<string, unknown> | null>(null)
  const [fileName,         setFileName]         = useState('')
  const [detected,         setDetected]         = useState<DetectedInput[]>([])
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<Set<string>>(new Set())
  const [imageDefaultKeys, setImageDefaultKeys] = useState<Set<string>>(new Set())
  const [fields,           setFields]           = useState<FieldDef[]>([])
  const [pathNodeId,       setPathNodeId]       = useState<string | null>(null)
  const [toolName,         setToolName]         = useState('')
  const [toolDesc,         setToolDesc]         = useState('')
  const [toolIcon,         setToolIcon]         = useState('sparkles')
  const [saving,           setSaving]           = useState(false)
  const [loadError,        setLoadError]        = useState<string | null>(null)

  // Load existing tool data when editing
  useEffect(() => {
    if (!editToolId) return
    getTool(editToolId)
      .then((raw: ToolDef) => {
        const wf = JSON.parse(raw.workflow) as Record<string, unknown>
        const det = detectInputs(wf)
        const parsedFields: FieldDef[] = JSON.parse(raw.fields_json || '[]')
        const pn = raw.path_nodes ? JSON.parse(raw.path_nodes) : null
        setWorkflowJson(wf)
        setFileName('existing workflow')
        setDetected(det)
        setFields(parsedFields.length ? parsedFields : det
          .filter(d => d.detected_type !== 'auto_seed' && d.detected_type !== 'output_path')
          .slice(0, 4)
          .map(buildFieldDef))
        setPathNodeId(pn?.node_id ?? null)
        setToolName(raw.name)
        setToolDesc(raw.description ?? '')
        setToolIcon(raw.icon ?? 'sparkles')
      })
      .catch(e => setLoadError(String(e)))
  }, [editToolId])

  // Output path nodes derived from the loaded workflow
  const outputPathNodes = useMemo(
    () => workflowJson ? detectOutputPathNodes(workflowJson) : [],
    [workflowJson],
  )

  // Auto-populate fields from the Step 1 selection when moving to Step 2
  const handleStep1Next = () => {
    if (fields.length === 0) {
      const candidates = detected.filter(d =>
        selectedNodeKeys.has(`${d.node_id}:${d.input_key}`)
      )
      const newFields = candidates.map((d, i) => {
        const def = buildFieldDef(d)
        if (d.detected_type === 'image' && imageDefaultKeys.has(`${d.node_id}:${d.input_key}`)) {
          def.default = 'example.png'
          def.required = false
        } else if (i === 0) {
          def.required = true
        }
        return def
      })
      setFields(newFields)
    }
    // Auto-suggest the first INDGOutputPath node
    if (pathNodeId === null && outputPathNodes.length > 0) {
      setPathNodeId(outputPathNodes[0].node_id)
    }
    setStep(2)
  }

  const handleSave = async () => {
    if (!workflowJson) return
    setSaving(true)
    try {
      const pathNodes  = pathNodeId ? JSON.stringify({ node_id: pathNodeId }) : null
      const autoNodes  = JSON.stringify(deriveAutoNodes(detected, fields))
      const fieldsJson = JSON.stringify(fields)
      const workflowStr = JSON.stringify(workflowJson)

      let toolId: string
      if (editToolId) {
        const updated = await updateTool(editToolId, {
          name:        toolName.trim(),
          description: toolDesc.trim(),
          icon:        toolIcon,
          fields_json: fieldsJson,
          path_nodes:  pathNodes,
          auto_nodes:  autoNodes,
        })
        toolId = updated.id
      } else {
        const created = await createTool({
          name:        toolName.trim(),
          description: toolDesc.trim(),
          icon:        toolIcon,
          fields_json: fieldsJson,
          path_nodes:  pathNodes,
          auto_nodes:  autoNodes,
          workflow:    workflowStr,
        })
        toolId = created.id
      }

      onSave(toolId)
    } catch (e) {
      alert(`Save failed: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">Failed to load tool for editing: {loadError}</p>
        <Button variant="ghost" size="sm" onClick={onDiscard}>Back</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 gap-6 min-h-0">
      {/* Header row */}
      <div className="shrink-0 flex items-center justify-between">
        <Stepper step={step} />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (window.confirm('Discard this tool?')) onDiscard()
          }}
        >
          <X className="w-3.5 h-3.5 mr-1" /> Discard
        </Button>
      </div>

      {step === 1 && (
        <div className="flex-1 min-h-0">
          <StepUpload
            workflowJson={workflowJson}
            setWorkflowJson={setWorkflowJson}
            fileName={fileName}
            setFileName={setFileName}
            detected={detected}
            setDetected={setDetected}
            selectedNodeKeys={selectedNodeKeys}
            setSelectedNodeKeys={setSelectedNodeKeys}
            imageDefaultKeys={imageDefaultKeys}
            setImageDefaultKeys={setImageDefaultKeys}
            onNext={handleStep1Next}
          />
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 min-h-0">
          <StepFields
            detected={detected}
            fields={fields}
            setFields={setFields}
            pathNodeId={pathNodeId}
            setPathNodeId={setPathNodeId}
            outputPathNodes={outputPathNodes}
            onBack={editToolId ? undefined : () => setStep(1)}
            onNext={() => setStep(3)}
          />
        </div>
      )}

      {step === 3 && (
        <div className="overflow-y-auto">
          <StepMeta
            toolName={toolName}     setToolName={setToolName}
            toolDesc={toolDesc}     setToolDesc={setToolDesc}
            toolIcon={toolIcon}     setToolIcon={setToolIcon}
            fields={fields}
            hasPathNode={pathNodeId !== null}
            onBack={() => setStep(2)}
            onSave={handleSave}
            saving={saving}
          />
        </div>
      )}
    </div>
  )
}
