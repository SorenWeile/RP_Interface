import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface MonitorStats {
  ram_total_gb: number
  ram_free_gb: number
  vram_total_gb: number
  vram_free_gb: number
  gpu_name: string
  queue_running: number
  queue_pending: number
  jobs: Array<{
    prompt_id: string
    position: number
    client_id: string
    status: 'running' | 'pending'
  }>
}

function UsageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{used.toFixed(1)} / {total.toFixed(1)} GB</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct < 70 ? 'bg-green-500' : pct < 90 ? 'bg-yellow-500' : 'bg-destructive',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function MachineMonitor() {
  const [stats, setStats]       = useState<MonitorStats | null>(null)
  const [error, setError]       = useState(false)
  const [showJobs, setShowJobs] = useState(false)
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/monitor/stats')
      if (!res.ok) throw new Error()
      setStats(await res.json())
      setError(false)
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    fetchStats()
    timerRef.current = setInterval(fetchStats, 5000)

    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current)
      } else {
        fetchStats()
        timerRef.current = setInterval(fetchStats, 5000)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const ramUsed  = stats ? stats.ram_total_gb  - stats.ram_free_gb  : 0
  const vramUsed = stats ? stats.vram_total_gb - stats.vram_free_gb : 0
  const totalJobs = stats ? stats.queue_running + stats.queue_pending : 0

  return (
    <div className="px-4 py-4 space-y-3.5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
        Machine
      </p>

      {error ? (
        <p className="text-xs text-destructive">Unreachable</p>
      ) : !stats ? (
        <p className="text-xs text-muted-foreground animate-pulse">Connecting…</p>
      ) : (
        <>
          {stats.gpu_name && (
            <p className="text-xs text-muted-foreground truncate" title={stats.gpu_name}>
              {stats.gpu_name}
            </p>
          )}

          <UsageBar label="RAM"  used={ramUsed}  total={stats.ram_total_gb}  />
          <UsageBar label="VRAM" used={vramUsed} total={stats.vram_total_gb} />

          {/* Queue row */}
          <button
            onClick={() => setShowJobs(v => !v)}
            className="w-full flex items-center justify-between text-xs hover:text-foreground transition-colors"
          >
            <span className="text-muted-foreground uppercase tracking-widest">Queue</span>
            <span className={cn(
              'font-medium tabular-nums',
              stats.queue_running > 0 ? 'text-primary' : 'text-muted-foreground',
            )}>
              {stats.queue_running > 0
                ? `● ${stats.queue_running} run${stats.queue_pending > 0 ? ` · ${stats.queue_pending} wait` : ''}`
                : stats.queue_pending > 0
                  ? `${stats.queue_pending} wait`
                  : 'idle'
              }
            </span>
          </button>

          {showJobs && totalJobs > 0 && (
            <div className="space-y-1 pl-1">
              {stats.jobs.map(job => (
                <div key={job.prompt_id} className="flex items-center gap-2 text-xs">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    job.status === 'running'
                      ? 'bg-primary animate-pulse'
                      : 'bg-muted-foreground/50',
                  )} />
                  <span className="font-mono text-muted-foreground truncate">
                    {job.prompt_id.slice(0, 8)}
                  </span>
                  <span className={cn(
                    'ml-auto shrink-0 text-muted-foreground/60',
                    job.status === 'running' && 'text-primary/70',
                  )}>
                    {job.status === 'running' ? 'run' : `#${job.position}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
