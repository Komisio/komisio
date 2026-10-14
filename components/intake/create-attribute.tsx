'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'
import {
  attributeDefinition,
  type AttributeDefinition,
} from '@/lib/engine/attributes'
import { createAttributeInput } from '@/lib/engine/create-attribute'

export function CreateAttribute({
  tenantId,
  locale,
  d,
  onCreated,
}: {
  tenantId: string
  locale: string
  d: Dictionary
  onCreated: (definition: AttributeDefinition) => void
}) {
  const t = d.vocabularySettings
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'text' | 'number' | 'choice' | 'boolean'>(
    'text',
  )
  const [unit, setUnit] = useState('')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<ReturnType<typeof createAttributeInput.parse> | null>(
    null,
  )
  const running = useRef(false)
  const triggerId = useId()
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) document.getElementById(triggerId)?.focus()
    wasOpen.current = open
  }, [open, triggerId])
  useUnsavedChanges(
    open && (name !== '' || unit !== '' || options !== '' || locked)
      ? t.leave
      : null,
  )
  function close() {
    setOpen(false)
  }
  async function save() {
    if (running.current || refused) return
    const parsed = createAttributeInput.safeParse(
      pending.current ?? {
        tenantId,
        requestId: crypto.randomUUID(),
        name,
        locale,
        dataType: kind,
        unit: kind === 'number' ? unit : '',
        choices:
          kind === 'choice'
            ? options
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      },
    )
    if (!parsed.success) {
      setError(t.invalid)
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch('/api/attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          if (result?.error === 'INVALID_INPUT') {
            pending.current = null
            setLocked(false)
            setError(t.invalid)
          } else {
            setRefused(true)
            setError(t.refused)
          }
        } else setError(t.uncertain)
        return
      }
      const definition = attributeDefinition.safeParse(result?.definition)
      if (
        result?.ok !== true ||
        result?.id !== parsed.data.requestId ||
        !definition.success ||
        !definition.data.own ||
        !definition.data.active ||
        definition.data.version !== 1 ||
        definition.data.slug !==
          `custom_${parsed.data.requestId.replaceAll('-', '')}` ||
        definition.data.labels[locale] !== parsed.data.name ||
        definition.data.data_type !== parsed.data.dataType ||
        definition.data.unit !== parsed.data.unit ||
        definition.data.choices.length !== parsed.data.choices.length ||
        definition.data.choices.some(
          (c, i) =>
            c.id !== `option_${i + 1}` ||
            c.labels[locale] !== parsed.data.choices[i],
        )
      ) {
        setError(t.uncertain)
        return
      }
      onCreated(definition.data)
      pending.current = null
      setLocked(false)
      close()
    } catch {
      setError(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button
        id={triggerId}
        type="button"
        variant="secondary"
        onClick={() => {
          setName('')
          setKind('text')
          setUnit('')
          setOptions('')
          setError('')
          setRefused(false)
          setOpen(true)
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {t.addAttribute}
      </Button>
    )
  return (
    <form
      className="vocabulary-editor"
      aria-label={t.addAttribute}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h3>{t.addAttribute}</h3>
      <fieldset disabled={busy || locked}>
        <div className="vocabulary-form-grid">
          <div className="field">
            <label htmlFor="attribute-name">{t.name}</label>
            <input
              id="attribute-name"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="attribute-kind">{t.kind}</label>
            <select
              id="attribute-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {Object.entries(t.kinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {kind === 'number' && (
            <div className="field">
              <label htmlFor="attribute-unit">{t.unit}</label>
              <input
                id="attribute-unit"
                maxLength={16}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          )}
          {kind === 'choice' && (
            <div className="field">
              <label htmlFor="attribute-options">{t.options}</label>
              <textarea
                id="attribute-options"
                rows={4}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                aria-describedby="attribute-options-hint"
              />
              <small id="attribute-options-hint">{t.optionsHint}</small>
            </div>
          )}
        </div>
      </fieldset>
      <div className="row wrap">
        <Button type="submit" disabled={busy || refused}>
          {busy
            ? d.quickIntake.busy
            : locked
              ? d.quickIntake.typeRetry
              : t.createAttribute}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || (locked && !refused)}
          onClick={() => {
            pending.current = null
            setLocked(false)
            close()
          }}
        >
          {d.quickIntake.typeCancel}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
