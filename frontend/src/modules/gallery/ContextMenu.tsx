import { useEffect, useRef, useState } from 'react'
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

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

  // After the menu renders, check if it overflows and flip if needed
  useEffect(() => {
    if (!menu) { setPos(null); return }
    if (!ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = menu.x + w > vw ? menu.x - w : menu.x
    const top  = menu.y + h > vh ? menu.y - h : menu.y
    setPos({ top, left })
  }, [menu])

  if (!menu) return null

  // Render off-screen first (opacity-0) so we can measure, then snap into place
  const style: React.CSSProperties = pos
    ? { position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }
    : { position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999, opacity: 0, pointerEvents: 'none' }

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
