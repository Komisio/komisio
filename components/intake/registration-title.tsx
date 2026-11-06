'use client'
import { useEffect, useId, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import { registrationTitleTemplate } from '@/lib/engine/registration'
import {
  addTitleField,
  moveTitleField,
  parseTitleTemplate,
  previewTitleTemplate,
  removeTitleField,
  serializeTitleTemplate,
  titleFields,
  type TitleField,
} from '@/lib/intake/title-template'
import './registration-title.css'

export function RegistrationTitle({
  value,
  onChange,
  d,
}: {
  value: string
  onChange: (value: string) => void
  d: Dictionary['registration']
}) {
  const id = useId()
  const t = d.titleBuilder
  const template = parseTitleTemplate(value)
  const label = (field: TitleField) =>
    d.visibility.fields[field === 'type' ? 'itemType' : field]
  const available = titleFields.filter(
    (field) => !template.fields.includes(field),
  )
  const valid = registrationTitleTemplate.safeParse(value).success
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const add = useRef<HTMLSelectElement>(null)
  const focus = useRef<number | 'add' | null>(null)
  useEffect(() => {
    if (focus.current !== null) {
      const target =
        focus.current === 'add' ? add.current : rows.current[focus.current]
      target?.focus()
      focus.current = null
    }
  }, [value])
  return (
    <fieldset className="registration-title" aria-describedby={`${id}-hint`}>
      <legend>{d.template}</legend>
      <p id={`${id}-hint`}>{d.templateHint}</p>
      <ol className="registration-title-fields" aria-label={t.selected}>
        {template.fields.map((field, index) => (
          <li
            key={index}
            ref={(element) => {
              rows.current[index] = element
            }}
            tabIndex={-1}
            aria-label={`${index + 1}. ${label(field)}`}
          >
            <span className="registration-title-label">{label(field)}</span>
            <div className="registration-title-actions">
              {([-1, 1] as const).map((direction) => {
                const text = (direction === -1 ? t.earlier : t.later).replace(
                  '{field}',
                  label(field),
                )
                const Icon = direction === -1 ? ArrowLeft : ArrowRight
                return (
                  <button
                    key={direction}
                    type="button"
                    aria-label={text}
                    title={text}
                    disabled={
                      index + direction < 0 ||
                      index + direction >= template.fields.length
                    }
                    onClick={() => {
                      focus.current = index + direction
                      onChange(moveTitleField(value, index, direction))
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </button>
                )
              })}
              <button
                type="button"
                aria-label={t.remove.replace('{field}', label(field))}
                title={t.remove.replace('{field}', label(field))}
                onClick={() => {
                  focus.current =
                    template.fields.length === 1
                      ? 'add'
                      : Math.min(index, template.fields.length - 2)
                  onChange(removeTitleField(value, index))
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <label className="sr-only" htmlFor={`${id}-add`}>
        {t.add}
      </label>
      <select
        id={`${id}-add`}
        ref={add}
        value=""
        disabled={available.length === 0}
        onChange={(event) => {
          const field = titleFields.find(
            (candidate) => candidate === event.target.value,
          )
          if (!field) return
          focus.current = template.fields.length
          onChange(addTitleField(value, field))
        }}
      >
        <option value="">{available.length ? t.add : t.allAdded}</option>
        {available.map((field) => (
          <option
            key={field}
            value={field}
            disabled={addTitleField(value, field).length > 240}
          >
            {label(field)}
          </option>
        ))}
      </select>
      <div
        className="registration-title-preview"
        role="status"
        aria-label={t.preview}
        aria-atomic="true"
      >
        <span>{t.preview}</span>
        <strong>{valid ? previewTitleTemplate(value, t.examples) : '—'}</strong>
      </div>
      <small>{t.missing}</small>
      <details className="registration-title-text">
        <summary>{t.customize}</summary>
        <p>{t.textHint}</p>
        {template.text.map((text, index) => (
          <div className="field" key={index}>
            <label htmlFor={`${id}-text-${index}`}>
              {index === 0
                ? t.before
                : t.after.replace(
                    '{field}',
                    `${index}. ${label(template.fields[index - 1])}`,
                  )}
            </label>
            <input
              id={`${id}-text-${index}`}
              value={text}
              maxLength={Math.max(0, 240 - value.length + text.length)}
              aria-invalid={!valid}
              aria-describedby={!valid ? `${id}-error` : undefined}
              onChange={(event) => {
                const next = parseTitleTemplate(value)
                next.text[index] = event.target.value
                onChange(serializeTitleTemplate(next))
              }}
            />
          </div>
        ))}
      </details>
      {!valid && (
        <p id={`${id}-error`} role="alert">
          {t.invalid}
        </p>
      )}
    </fieldset>
  )
}
