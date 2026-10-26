'use client'
import { useId, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'

/** Keep the selected localized reason as immutable human evidence. */
export function PriceReason({
  d,
  name = 'reason',
  disabled = false,
}: {
  d: Dictionary['priceEdit']
  name?: string
  disabled?: boolean
}) {
  const id = useId(),
    [choice, setChoice] = useState('')
  return (
    <div className="field">
      <label htmlFor={id}>{d.reason}</label>
      <select
        id={id}
        value={choice}
        disabled={disabled}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="">{d.none}</option>
        {(['store', 'sale', 'defect', 'other'] as const).map((key) => (
          <option key={key} value={key}>
            {d[key]}
          </option>
        ))}
      </select>
      {choice === 'other' ? (
        <>
          <label htmlFor={`${id}-custom`}>{d.custom}</label>
          <input
            id={`${id}-custom`}
            name={name}
            maxLength={500}
            disabled={disabled}
          />
        </>
      ) : (
        <input
          type="hidden"
          disabled={disabled}
          name={name}
          value={choice ? d[choice as 'store' | 'sale' | 'defect'] : ''}
        />
      )}
    </div>
  )
}
