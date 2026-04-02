import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'destructive'
  separator?: false
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuEntry[]
}

interface Props {
  menu: ContextMenuState | null
  onClose: () => void
}

export default function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [menu, onClose])

  if (!menu) return null

  // Keep menu on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    top: menu.y,
    left: menu.x,
    zIndex: 9999,
  }

  return (
    <div
      ref={ref}
      style={style}
      className="bg-card border border-border rounded-md shadow-xl py-1 min-w-[160px] text-sm"
    >
      {menu.items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return <div key={i} className="border-t border-border my-1" />
        }
        const it = item as ContextMenuItem
        return (
          <button
            key={i}
            onClick={() => { it.onClick(); onClose() }}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
              it.variant === 'destructive'
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-foreground hover:bg-accent',
            )}
          >
            {it.icon && <span className="w-4 h-4 shrink-0 flex items-center">{it.icon}</span>}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
