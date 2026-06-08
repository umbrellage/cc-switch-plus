import { useState, useRef, useEffect } from 'react'
import type { ModelConfig } from './types'

interface ModelPickerProps {
  configs: ModelConfig[]
  value: string
  placeholder: string
  disabled?: boolean
  onChange: (shortName: string) => void
}

export default function ModelPicker({ configs, value, placeholder, disabled, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = configs.find((c) => c.shortName === value)
  const label = selected?.name || placeholder

  return (
    <div className={`picker ${disabled ? 'disabled' : ''} ${open ? 'open' : ''}`} ref={ref}>
      <button
        className="picker-trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className={`picker-label ${selected ? 'selected' : 'placeholder'}`}>
          {label}
        </span>
        <span className="picker-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="picker-dropdown">
          {configs.map((cfg) => (
            <button
              key={cfg.id}
              className={`picker-option ${cfg.shortName === value ? 'active' : ''}`}
              onClick={() => {
                onChange(cfg.shortName)
                setOpen(false)
              }}
            >
              <span className="picker-option-name">{cfg.name}</span>
              {cfg.opusModel && (
                <span className="picker-option-model">{cfg.opusModel}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
