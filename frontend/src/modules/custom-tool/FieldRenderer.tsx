import { useCallback, useState } from 'react'
import { User } from 'lucide-react'
import { uploadImage } from '@/api/client'
import { Input } from '@/components/ui/input'
import DropZone, { type ImageSlot } from '@/components/DropZone'
import { cn } from '@/lib/utils'
import type { FieldDef } from '@/modules/workflow-builder/types'

interface Props {
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
}

const EMPTY_SLOT: ImageSlot = { preview: null, filename: null, state: 'empty' }

const BASE_INPUT =
  'w-full px-3 py-2 rounded-md border border-input bg-background text-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60'

function ImageField({ field, onChange, disabled }: Omit<Props, 'value'>) {
  const [slot, setSlot] = useState<ImageSlot>(EMPTY_SLOT)

  const handleFile = useCallback(async (file: File) => {
    const preview = URL.createObjectURL(file)
    setSlot({ preview, filename: null, state: 'uploading' })
    try {
      const { filename } = await uploadImage(file)
      setSlot({ preview, filename, state: 'ready' })
      onChange(filename)
    } catch {
      setSlot({ preview, filename: null, state: 'error' })
      onChange(null)
    }
  }, [onChange])

  const clearSlot = () => {
    setSlot(EMPTY_SLOT)
    onChange(null)
  }

  return (
    <DropZone
      slot={slot}
      label={field.placeholder ?? 'Drop image here or click to browse'}
      disabled={disabled}
      onFile={handleFile}
      onClear={clearSlot}
    />
  )
}

export default function FieldRenderer({ field, value, onChange, disabled }: Props) {
  switch (field.type) {
    case 'image':
      return <ImageField field={field} onChange={onChange} disabled={disabled} />

    case 'text':
      return (
        <Input
          value={(value as string) ?? ''}
          placeholder={field.placeholder ?? ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        />
      )

    case 'textarea':
      return (
        <textarea
          value={(value as string) ?? ''}
          placeholder={field.placeholder ?? ''}
          rows={field.rows ?? 3}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={cn(BASE_INPUT, 'resize-y')}
        />
      )

    case 'number':
      return (
        <Input
          type="number"
          value={(value as number) ?? (field.default as number) ?? 0}
          placeholder={field.placeholder ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={e => onChange(Number(e.target.value))}
          disabled={disabled}
        />
      )

    case 'slider': {
      const num = (value as number) ?? (field.default as number) ?? field.min ?? 0
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{field.min ?? 0}</span>
            <span className="text-xs font-medium text-foreground">{num}</span>
            <span className="text-xs text-muted-foreground">{field.max ?? 100}</span>
          </div>
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={num}
            onChange={e => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full accent-primary disabled:opacity-50"
          />
        </div>
      )
    }

    case 'select':
      return (
        <select
          value={(value as string) ?? (field.default as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={BASE_INPUT}
        >
          {!field.required && <option value="">— Select —</option>}
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )

    case 'toggle': {
      const checked = (value as boolean) ?? (field.default as boolean) ?? false
      return (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 accent-primary disabled:opacity-50"
          />
          <span className="text-sm text-foreground">{checked ? 'On' : 'Off'}</span>
        </label>
      )
    }

    case 'user':
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-muted/30 text-xs text-muted-foreground select-none">
          <User className="w-3.5 h-3.5 shrink-0" />
          Auto-injected: logged-in username
        </div>
      )

    default:
      return null
  }
}
