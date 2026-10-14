'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useEffect, useId, useRef, useState } from 'react'
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
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

export function CreateItemType({
  tenantId,
  vocabulary,
  lang,
  disabled,
  d,
  settings,
  onSelect,
}: {
  tenantId: string
  vocabulary: AttributeVocabulary
  lang: string
  disabled: boolean
  d: Dictionary['quickIntake']
  settings: Dictionary['vocabularySettings']
  onSelect: (profile: ItemTypeProfile) => void
}) {
  const editorId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [base, setBase] = useState('')
  const [fields, setFields] = useState<string[]>(['description'])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<ReturnType<typeof createItemTypeInput.parse> | null>(
    null,
  )
  const running = useRef(false)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open)
      document.getElementById(`${editorId}-trigger`)?.focus()
    wasOpen.current = open
  }, [open, editorId])
  useUnsavedChanges(
    open && (name !== '' || fields.length > 1 || locked)
      ? settings.leave
      : null,
  )
  function close() {
    setOpen(false)
  }
  async function save() {
    if (disabled || running.current || refused) return
    const attributes = fields.map((slug, sort) => ({
      slug,
      sort,
      expected: slug === 'description',
    }))
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
            setError(settings.refused)
          }
        } else setError(settings.uncertain)
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
        setError(settings.uncertain)
        return
      }
      onSelect(profile.data)
      pending.current = null
      setLocked(false)
      setName('')
      close()
    } catch {
      setError(settings.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button
        id={`${editorId}-trigger`}
        type="button"
        variant="secondary"
        className="create-type-trigger"
        aria-expanded={false}
        disabled={disabled}
        onClick={() => {
          setBase('')
          setFields(['description'])
          setSearch('')
          setError('')
          setRefused(false)
          setOpen(true)
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
          onChange={(e) => {
            setBase(e.target.value)
            setFields(
              vocabulary.types
                .find((t) => t.slug === e.target.value)
                ?.attributes.map((a) => a.slug) ?? ['description'],
            )
          }}
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
      <fieldset disabled={busy || locked || disabled}>
        <legend>{d.typeFieldsLegend}</legend>
        <div className="field">
          <label htmlFor={`${editorId}-search`}>{settings.searchFields}</label>
          <input
            id={`${editorId}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="vocabulary-field-choices">
          {vocabulary.definitions
            .filter(
              (a) =>
                a.active &&
                a.slug !== 'category' &&
                labelOf(a, lang)
                  .toLocaleLowerCase(lang)
                  .includes(search.toLocaleLowerCase(lang)),
            )
            .sort((a, b) =>
              labelOf(a, lang).localeCompare(labelOf(b, lang), lang),
            )
            .map((a) => (
              <label key={a.slug} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={fields.includes(a.slug)}
                  disabled={a.slug === 'description'}
                  onChange={(e) =>
                    setFields((current) =>
                      e.target.checked
                        ? [...current, a.slug]
                        : current.filter((s) => s !== a.slug),
                    )
                  }
                />
                {labelOf(a, lang)}
              </label>
            ))}
        </div>
      </fieldset>
      <div className="row wrap">
        <Button
          type="button"
          disabled={busy || disabled || refused}
          onClick={() => void save()}
        >
          {busy ? d.busy : locked ? d.typeRetry : settings.createType}
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
          {d.typeCancel}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
