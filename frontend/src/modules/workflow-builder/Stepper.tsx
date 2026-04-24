import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const LABELS = ['Upload', 'Configure', 'Save'] as const

export default function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-card border border-border rounded-md">
      {LABELS.map((label, i) => {
        const n    = i + 1
        const done = step > n
        const active = step === n
        return (
          <div key={label} className="flex items-center gap-2.5">
            {n > 1 && (
              <div className={cn('w-6 h-px', done || active ? 'bg-primary/40' : 'bg-border')} />
            )}
            <div className={cn(
              'flex items-center gap-2 text-xs',
              active ? 'text-primary' : done ? 'text-primary/70' : 'text-muted-foreground',
            )}>
              <div className={cn(
                'w-5 h-5 rounded-full border flex items-center justify-center text-[10px] shrink-0',
                active ? 'bg-primary border-primary text-primary-foreground' :
                done   ? 'border-primary/60 text-primary/70' :
                         'border-border bg-background',
              )}>
                {done ? <Check className="w-3 h-3" /> : n}
              </div>
              <span className="hidden sm:inline">{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
