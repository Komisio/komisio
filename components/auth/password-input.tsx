'use client'
import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/** Visibility is local to this input; password-manager and paste behavior stay native. */
export function PasswordInput({
  showLabel,
  hideLabel,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string
  showLabel: string
  hideLabel: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-visibility"
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOff size={20} aria-hidden="true" />
        ) : (
          <Eye size={20} aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
