import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

interface Client  { id: number; client_id: string; name: string }
interface Project { id: number; project_id: string; name: string; client_id: number | null }

interface Props {
  clientPath:   string
  productPath:  string
  filePrefix:   string
  onClientPath:  (v: string) => void
  onProductPath: (v: string) => void
  onFilePrefix:  (v: string) => void
  disabled?: boolean
}

export default function ClientProjectPicker({
  clientPath, productPath, filePrefix,
  onClientPath, onProductPath, onFilePrefix,
  disabled,
}: Props) {
  const [clients,  setClients]  = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('user_token') ?? ''
    fetch('/api/auth/path-options', { headers: { 'X-User-Token': token } })
      .then(r => r.json())
      .then(data => { setClients(data.clients); setProjects(data.projects) })
      .catch(() => {})
  }, [])

  const filteredProjects = selectedClientId != null
    ? projects.filter(p => p.client_id === selectedClientId)
    : projects

  const selectedProjectId = projects.find(p => p.project_id === productPath)?.id ?? ''

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (!val) {
      setSelectedClientId(null)
      onClientPath('')
      onProductPath('')
      return
    }
    const client = clients.find(c => c.id === parseInt(val))
    if (!client) return
    setSelectedClientId(client.id)
    onClientPath(client.client_id)
    onProductPath('')
  }

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (!val) { onProductPath(''); return }
    const project = projects.find(p => p.id === parseInt(val))
    if (project) onProductPath(project.project_id)
  }

  const selectClass =
    'w-full px-3 py-2 rounded-md border border-input bg-background text-sm ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60'

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Client</label>
        <select
          disabled={disabled}
          value={selectedClientId?.toString() ?? ''}
          onChange={handleClientChange}
          className={selectClass}
        >
          <option value="">— Select client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {clientPath && (
          <p className="text-xs text-muted-foreground font-mono truncate">{clientPath}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Project</label>
        <select
          disabled={disabled || selectedClientId == null}
          value={selectedProjectId.toString()}
          onChange={handleProjectChange}
          className={selectClass}
        >
          <option value="">— Select project —</option>
          {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {productPath && (
          <p className="text-xs text-muted-foreground font-mono truncate">{productPath}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">Filename Prefix</label>
        <Input
          placeholder="Shot001"
          value={filePrefix}
          onChange={e => onFilePrefix(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
