'use client'
import { useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import {
  labelOf,
  itemTypeProfile,
  type AttributeVocabulary,
  type ItemTypeProfile,
} from '@/lib/engine/attributes'
import { createItemTypeInput } from '@/lib/engine/create-item-type'
import { Button } from '@/components/ui/button'

export function CreateItemType({
  tenantId,
  vocabulary,
  selected,
  lang,
  disabled,
  d,
  onSelect,
  onOpenChange,
}: {
  tenantId: string
  vocabulary: AttributeVocabulary
  selected: string | null
  lang: string
  disabled: boolean
  d: Dictionary['quickIntake']
  onSelect: (profile: ItemTypeProfile) => void
  onOpenChange: (open: boolean) => void
}) {
  const editorId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<ReturnType<typeof createItemTypeInput.parse> | null>(
    null,
  )
  const running = useRef(false)
  function close() {
    setOpen(false)
    onOpenChange(false)
  }
  async function save() {
    if (disabled || running.current || refused) return
    const attributes = base
      ? vocabulary.types.find((t) => t.slug === base)?.attributes
      : [{ slug: 'description', expected: true, sort: 0 }]
    const parsed = createItemTypeInput.safeParse(
      pending.current ?? {
        tenantId,
        requestId: crypto.randomUUID(),
        name,
        locale: lang,
        attributes,
      },
    )
    if (!parsed.success) {
      setError(d.typeInvalid)
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch('/api/item-types', {
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
            setError(d.typeInvalid)
          } else {
            setRefused(true)
            setError(d.typeRefused)
          }
        } else setError(d.typeUncertain)
        return
      }
      const profile = itemTypeProfile.safeParse(result?.profile)
      if (
        result?.ok !== true ||
        result?.id !== parsed.data.requestId ||
        !profile.success ||
        !profile.data.own ||
        !profile.data.active ||
        profile.data.slug !==
          `custom_${parsed.data.requestId.replaceAll('-', '')}` ||
        profile.data.labels[lang] !== parsed.data.name
      ) {
        setError(d.typeUncertain)
        return
      }
      onSelect(profile.data)
      pending.current = null
      setLocked(false)
      setName('')
      close()
    } catch {
      setError(d.typeUncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button
        type="button"
        variant="secondary"
        className="create-type-trigger"
        aria-expanded={false}
        disabled={disabled}
        onClick={() => {
          setBase(selected ?? '')
          setError('')
          setRefused(false)
          setOpen(true)
          onOpenChange(true)
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {d.createType}
      </Button>
    )
  return (
    <div
      className="create-type-editor"
      role="group"
      aria-labelledby={`${editorId}-title`}
      aria-describedby={`${editorId}-intro`}
      onKeyDown={(e) => {
        if (
          e.key === 'Enter' &&
          (e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLSelectElement)
        ) {
          e.preventDefault()
          e.stopPropagation()
          if (e.target instanceof HTMLInputElement) void save()
        }
      }}
    >
      <div className="create-type-heading">
        <h3 id={`${editorId}-title`}>{d.createType}</h3>
        <p id={`${editorId}-intro`}>{d.typeIntro}</p>
      </div>
      <div className="field">
        <label htmlFor="new-type-name">{d.typeName}</label>
        <input
          id="new-type-name"
          autoFocus
          maxLength={120}
          value={name}
          disabled={busy || locked || disabled}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-type-base">{d.typeFields}</label>
        <select
          id="new-type-base"
          aria-describedby={`${editorId}-fields-hint`}
          value={base}
          disabled={busy || locked || disabled}
          onChange={(e) => setBase(e.target.value)}
        >
          <option value="">{d.typeBasic}</option>
          {vocabulary.types
            .filter(
              (t) =>
                t.active && t.attributes.some((a) => a.slug === 'description'),
            )
            .map((t) => (
              <option key={t.slug} value={t.slug}>
                {labelOf(t, lang)}
              </option>
            ))}
        </select>
        <small id={`${editorId}-fields-hint`}>{d.typeFieldsHint}</small>
      </div>
      <div className="row wrap">
        <Button
          type="button"
          disabled={busy || disabled || refused}
          onClick={() => void save()}
        >
          {busy ? d.busy : locked ? d.typeRetry : d.typeCreateSelect}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || (locked && !refused)}
          onClick={() => {
            pending.current = null
            setLocked(false)
            close()
            requestAnimationFrame(() =>
              document.getElementById('quick-item-type')?.focus(),
            )
          }}
        >
          {d.typeCancel}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
