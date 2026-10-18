'use client'
import { useId, useRef, useState } from 'react'
import { z } from 'zod'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
import { itemCategory, type ItemCategory } from '@/lib/engine/item-categories'
import {
  itemTypeProfile,
  labelOf,
  type ItemTypeProfile,
  type AttributeDefinition,
} from '@/lib/engine/attributes'
import { catalogueEditCommand } from '@/lib/engine/edit-catalogue'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'

type RecordProps =
  | {
      kind: 'category'
      record: ItemCategory
      onSaved: (record: ItemCategory) => void
    }
  | {
      kind: 'type'
      record: ItemTypeProfile
      onSaved: (record: ItemTypeProfile) => void
    }
export function EditCatalogue(
  props: RecordProps & {
    tenantId: string
    locale: string
    d: Dictionary
    definitions?: AttributeDefinition[]
    onClose: () => void
  },
) {
  const { tenantId, locale, d, onClose } = props
  const t = d.catalogueEditing
  const prefix = useId()
  const [labels, setLabels] = useState<Record<string, string>>({
    ...props.record.labels,
  })
  const [active, setActive] = useState(props.record.active)
  const [name, setName] = useState(
    props.kind === 'category' ? props.record.name : '',
  )
  const [suggestedCategory, setSuggestedCategory] = useState(
    props.kind === 'type' ? props.record.suggested_category : '',
  )
  const [fields, setFields] = useState(
    props.kind === 'type' ? props.record.attributes : [],
  )
  const [busy, setBusy] = useBusyState(false)
  const [status, setStatus] = useState<
    'idle' | 'invalid' | 'uncertain' | 'refused'
  >('idle')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const pending = useRef<z.infer<typeof catalogueEditCommand> | null>(null)
  const running = useRef(false)
  const locked = busy || status === 'uncertain' || status === 'refused'
  useUnsavedChanges(
    dirty || busy || status === 'uncertain' ? d.leaveUnsaved : null,
    prefix,
  )
  async function save() {
    if (running.current || status === 'refused') return
    const cleaned = Object.fromEntries(
      Object.entries(labels)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    )
    const parsed = catalogueEditCommand.safeParse(
      pending.current ??
        (props.kind === 'category'
          ? {
              kind: 'category',
              tenantId,
              requestId: crypto.randomUUID(),
              id: props.record.id,
              expected: props.record.version,
              name,
              labels: cleaned,
              active,
            }
          : {
              kind: 'type',
              tenantId,
              slug: props.record.slug,
              expected: props.record,
              payload: {
                labels: cleaned,
                suggestedCategory,
                active,
                attributes: fields,
              },
            }),
    )
    if (!parsed.success) {
      setStatus('invalid')
      setError(d.vocabularySettings.nameRequired)
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/catalogue/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await response.json()
      if (response.ok && body.ok === true) {
        if (props.kind === 'category') {
          const record = itemCategory.parse(body.category)
          if (
            record.id !== props.record.id ||
            body.id !==
              (parsed.data.kind === 'category' ? parsed.data.requestId : null)
          )
            throw Error('Invalid receipt')
          props.onSaved(record)
        } else {
          const record = itemTypeProfile.parse(body.profile)
          if (record.slug !== props.record.slug) throw Error('Invalid receipt')
          props.onSaved(record)
        }
        setDirty(false)
        pending.current = null
        onClose()
      } else if (response.status >= 400 && response.status < 500) {
        setStatus('refused')
        setError(
          body.error === 'CATALOGUE_CHANGED'
            ? t.changed
            : ['CATEGORY_EXISTS', 'ITEM_TYPE_NAME_EXISTS'].includes(body.error)
              ? t.duplicate
              : d.vocabularySettings.refused,
        )
      } else {
        setStatus('uncertain')
        setError(d.vocabularySettings.uncertain)
      }
    } catch {
      setStatus('uncertain')
      setError(d.vocabularySettings.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const heading = `${t.edit}: ${props.kind === 'category' ? props.record.name : labelOf(props.record, locale)}`
  return (
    <form
      className="vocabulary-editor"
      aria-label={heading}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onChange={() => setDirty(true)}
    >
      <h3>{heading}</h3>
      <fieldset disabled={locked}>
        <div className="field">
          <label htmlFor={`${prefix}-name`}>{d.vocabularySettings.name}</label>
          <input
            id={`${prefix}-name`}
            autoFocus
            maxLength={120}
            required
            value={props.kind === 'category' ? name : (labels[locale] ?? '')}
            onChange={(e) => {
              if (props.kind === 'category') {
                setName(e.target.value)
                setLabels({ ...labels, [locale]: e.target.value })
              } else setLabels({ ...labels, [locale]: e.target.value })
            }}
          />
        </div>
        <details>
          <summary>{d.vocabularySettings.translations}</summary>
          <div className="vocabulary-form-grid">
            {locales
              .filter((l) => props.kind === 'category' || l !== locale)
              .map((l) => (
                <div className="field" key={l}>
                  <label htmlFor={`${prefix}-${l}`}>{localeNames[l]}</label>
                  <input
                    id={`${prefix}-${l}`}
                    maxLength={120}
                    value={labels[l] ?? ''}
                    onChange={(e) =>
                      setLabels({ ...labels, [l]: e.target.value })
                    }
                  />
                </div>
              ))}
          </div>
        </details>
        {props.kind === 'type' && (
          <>
            <div className="field">
              <label htmlFor={`${prefix}-suggestion`}>
                {t.suggestedCategory}
              </label>
              <input
                id={`${prefix}-suggestion`}
                maxLength={120}
                value={suggestedCategory}
                onChange={(e) => setSuggestedCategory(e.target.value)}
              />
            </div>
            <fieldset>
              <legend>{d.vocabularySettings.fields}</legend>
              <div className="vocabulary-field-choices">
                {(props.definitions ?? [])
                  .filter(
                    (a) => a.active || fields.some((f) => f.slug === a.slug),
                  )
                  .map((a) => (
                    <label className="checkbox-label" key={a.slug}>
                      <input
                        type="checkbox"
                        disabled={
                          a.slug === 'description' &&
                          fields.some((f) => f.slug === a.slug)
                        }
                        checked={fields.some((f) => f.slug === a.slug)}
                        onChange={(e) =>
                          setFields(
                            e.target.checked
                              ? [
                                  ...fields,
                                  {
                                    slug: a.slug,
                                    expected: true,
                                    sort:
                                      Math.max(
                                        -1,
                                        ...fields.map((f) => f.sort),
                                      ) + 1,
                                  },
                                ]
                              : fields.filter((f) => f.slug !== a.slug),
                          )
                        }
                      />
                      {labelOf(a, locale)}
                    </label>
                  ))}
              </div>
            </fieldset>
          </>
        )}
        <div className="vocabulary-field-choices">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t.active}
          </label>
        </div>
        <small>{t.activeHint}</small>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="catalogue-delete-actions">
        <Button type="submit" disabled={busy || status === 'refused'}>
          {status === 'uncertain' ? d.quickIntake.typeRetry : t.save}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || status === 'uncertain'}
          onClick={onClose}
        >
          {d.quickIntake.typeCancel}
        </Button>
      </div>
    </form>
  )
}
