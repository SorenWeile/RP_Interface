import { useMemo, useState } from 'react'
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

function deriveAutoNodes(detected: DetectedInput[]) {
  return detected
    .filter(d => d.detected_type === 'auto_seed' || d.detected_type === 'auto_user')
    .map(d => ({
      node_id:   d.node_id,
      input_key: d.input_key,
      strategy:  d.detected_type === 'auto_seed' ? 'random_seed' : 'username',
    }))
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
  const [step,         setStep]         = useState<1 | 2 | 3>(editToolId ? 2 : 1)
  const [workflowJson, setWorkflowJson] = useState<Record<string, unknown> | null>(null)
  const [fileName,     setFileName]     = useState('')
  const [detected,     setDetected]     = useState<DetectedInput[]>([])
  const [fields,       setFields]       = useState<FieldDef[]>([])
  const [pathNodeId,   setPathNodeId]   = useState<string | null>(null)
  const [toolName,     setToolName]     = useState('')
  const [toolDesc,     setToolDesc]     = useState('')
  const [toolIcon,     setToolIcon]     = useState('sparkles')
  const [saving,       setSaving]       = useState(false)
  const [loadError,    setLoadError]    = useState<string | null>(null)

  // Load existing tool data when editing
  const [editLoaded, setEditLoaded] = useState(false)
  if (editToolId && !editLoaded && !loadError) {
    setEditLoaded(true)  // prevent re-entry
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
          .filter(d => d.detected_type !== 'auto_seed' && d.detected_type !== 'auto_user' && d.detected_type !== 'output_path')
          .slice(0, 4)
          .map(buildFieldDef))
        setPathNodeId(pn?.node_id ?? null)
        setToolName(raw.name)
        setToolDesc(raw.description ?? '')
        setToolIcon(raw.icon ?? 'sparkles')
      })
      .catch(e => setLoadError(String(e)))
  }

  // Output path nodes derived from the loaded workflow
  const outputPathNodes = useMemo(
    () => workflowJson ? detectOutputPathNodes(workflowJson) : [],
    [workflowJson],
  )

  // Auto-populate fields and pathNodeId when moving from step 1 → 2
  const handleStep1Next = () => {
    if (fields.length === 0) {
      // Pre-fill first 4 non-auto inputs
      const candidates = detected.filter(d =>
        d.detected_type !== 'auto_seed' &&
        d.detected_type !== 'auto_user' &&
        d.detected_type !== 'output_path'
      ).slice(0, 4)
      setFields(candidates.map((d, i) => ({ ...buildFieldDef(d), required: i === 0 })))
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
      const pathNodes = pathNodeId ? JSON.stringify({ node_id: pathNodeId }) : null
      const autoNodes = JSON.stringify(deriveAutoNodes(detected))
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
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
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
        <StepUpload
          workflowJson={workflowJson}
          setWorkflowJson={setWorkflowJson}
          fileName={fileName}
          setFileName={setFileName}
          detected={detected}
          setDetected={setDetected}
          onNext={handleStep1Next}
        />
      )}

      {step === 2 && (
        <StepFields
          detected={detected}
          fields={fields}
          setFields={setFields}
          pathNodeId={pathNodeId}
          setPathNodeId={setPathNodeId}
          outputPathNodes={outputPathNodes}
          onBack={() => setStep(editToolId ? 2 : 1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
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
      )}
    </div>
  )
}
