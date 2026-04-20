import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { X, CheckCircle, AlertCircle, Info, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info' | 'loading'

interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => string
  dismiss: (id: string) => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info', duration = 4000): string => {
      const id = Math.random().toString(36).slice(2)
      setToasts(prev => [...prev.slice(-4), { id, message, type }]) // keep max 5
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }
      return id
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm pointer-events-auto',
              t.type === 'success' && 'bg-green-950 border-green-800 text-green-100',
              t.type === 'error'   && 'bg-destructive/15 border-destructive/40 text-destructive-foreground',
              t.type === 'info'    && 'bg-card border-border text-foreground',
              t.type === 'loading' && 'bg-card border-border text-foreground',
            )}
          >
            {t.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-green-400" />}
            {t.type === 'error'   && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />}
            {t.type === 'info'    && <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />}
            {t.type === 'loading' && <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin text-primary" />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
