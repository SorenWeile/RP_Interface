import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ComfyUI() {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(0)

  function load() {
    setError(null)
    setUrl(null)
    fetch('/api/comfyui/url')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => setUrl(data.url))
      .catch(e => setError(String(e.message ?? e)))
  }

  useEffect(() => { load() }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="text-sm">Could not reach ComfyUI: {error}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Connecting to ComfyUI…</span>
      </div>
    )
  }

  return (
    <iframe
      key={key}
      src={url}
      className="w-full h-full border-0"
      title="ComfyUI"
      allow="clipboard-read; clipboard-write"
      onError={() => setError('Failed to load ComfyUI — is the container running?')}
    />
  )
}
