import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface StorageInfo {
  path:  string
  ok:    boolean | null
  label: string | null
}

interface StorageStatusData {
  output: StorageInfo
  db:     StorageInfo
}

export default function StorageStatus() {
  const [data,        setData]        = useState<StorageStatusData | null>(null)
  const [error,       setError]       = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const timerRef                      = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetch_ = async () => {
    try {
      const res = await fetch('/api/storage/status')
      if (res.status === 404) { setUnavailable(true); return }
      if (!res.ok) throw new Error()
      setData(await res.json())
      setError(false)
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    fetch_()
    timerRef.current = setInterval(fetch_, 30_000)
    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current)
      } else {
        fetch_()
        timerRef.current = setInterval(fetch_, 30_000)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Backend doesn't support this endpoint (old version) — hide the whole widget
  if (unavailable) return null

  const rows: Array<{ key: string; info: StorageInfo; sublabel: string }> = data
    ? [
        { key: 'output', info: data.output, sublabel: 'Gallery' },
        ...(data.db.path ? [{ key: 'db', info: data.db, sublabel: 'Database' }] : []),
      ]
    : []

  // Deduplicate rows that share the same label + ok status (same NAS, e.g.)
  const deduped = rows.filter((row, i) =>
    i === 0 ||
    rows[i - 1].info.label !== row.info.label ||
    rows[i - 1].info.ok    !== row.info.ok
  )

  return (
    <div className="px-4 py-4 space-y-2.5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
        Storage
      </p>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
          Unreachable
        </div>
      ) : !data ? (
        <p className="text-xs text-muted-foreground animate-pulse">Checking…</p>
      ) : (
        <div className="space-y-1.5">
          {deduped.map(({ key, info, sublabel }) => (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  info.ok === true  ? 'bg-green-500'   :
                  info.ok === false ? 'bg-destructive'  :
                                     'bg-muted-foreground/40',
                )} />
                <span className={cn(
                  'text-xs font-medium',
                  info.ok === true  ? 'text-foreground'      :
                  info.ok === false ? 'text-destructive'      :
                                     'text-muted-foreground',
                )}>
                  {info.label ?? sublabel}
                  {' · '}
                  {info.ok === true ? 'Connected' : info.ok === false ? 'Unreachable' : '—'}
                </span>
              </div>
              {info.label && (
                <p className="text-[10px] text-muted-foreground/60 pl-3.5 truncate" title={info.path}>
                  {(p => {
                    const fwd = p.replace(/\\/g, '/')
                    if (fwd.startsWith('//')) {
                      // UNC: //host/share/... → host/share
                      return fwd.replace(/^\/\//, '').split('/').slice(0, 2).join('/')
                    }
                    // Linux mount: /nas/indgai/... → /nas/indgai
                    const parts = fwd.split('/').filter(Boolean)
                    return '/' + parts.slice(0, 2).join('/')
                  })(info.path)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
