'use client'
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  attributeVocabulary,
  labelOf,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'
import {
  defaultRegistration,
  hideableIntakeFields,
  intakeFieldVisible,
  registrationCommand,
} from '@/lib/engine/registration'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

export function RegistrationSettings({
  tenantId,
  vocabulary,
  locale,
  editable,
  d,
  onSaved,
}: {
  tenantId: string
  vocabulary: AttributeVocabulary
  locale: string
  editable: boolean
  d: Dictionary
  onSaved: (v: AttributeVocabulary) => void
}) {
  const t = d.registration,
    prefix = useId()
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [record, setRecord] = useState(
    vocabulary.registration ?? { id: null, settings: defaultRegistration },
  )
  const [settings, setSettings] = useState(record.settings)
  const [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [message, setMessage] = useState('')
  const pending = useRef<ReturnType<typeof registrationCommand.parse> | null>(
      null,
    ),
    running = useRef(false)
  const dirty = JSON.stringify(settings) !== JSON.stringify(record.settings)
  useUnsavedChanges(dirty || locked ? d.leaveUnsaved : null, prefix)
  async function save() {
    if (running.current || refused) return
    const c = registrationCommand.safeParse(
      pending.current ?? {
        action: 'settings',
        tenantId,
        requestId: crypto.randomUUID(),
        expectedId: record.id,
        settings,
      },
    )
    if (!c.success) {
      setMessage(t.invalid)
      return
    }
    pending.current = c.data
    running.current = true
    setBusy(true)
    setLocked(true)
    setMessage('')
    try {
      const response = await fetch('/api/registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.data),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          setRefused(true)
          setMessage(t.changed)
        } else setMessage(t.uncertain)
        return
      }
      const v = attributeVocabulary.parse(body.vocabulary)
      if (body.id !== c.data.requestId || !v.registration) throw Error()
      setRecord(v.registration)
      setSettings(v.registration.settings)
      onSaved(v)
      pending.current = null
      setLocked(false)
      setMessage(t.saved)
    } catch {
      setMessage(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card vocabulary-panel">
      <h3>{t.title}</h3>
      <p>{t.hint}</p>
      <fieldset disabled={!ready || !editable || locked}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.descriptionRequired}
            onChange={(e) =>
              setSettings({
                ...settings,
                descriptionRequired: e.target.checked,
                ...(e.target.checked
                  ? {
                      hiddenFields: (settings.hiddenFields ?? []).filter(
                        (field) => field !== 'description',
                      ),
                    }
                  : {}),
              })
            }
          />
          {t.descriptionRequired}
        </label>
        <fieldset
          className="registration-visibility"
          aria-describedby={`${prefix}-visibility-hint`}
        >
          <legend>{t.visibility.title}</legend>
          <p id={`${prefix}-visibility-hint`}>{t.visibility.hint}</p>
          <div className="vocabulary-field-choices">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked
                disabled
                aria-describedby={`${prefix}-price-locked`}
              />
              {t.visibility.fields.price}
            </label>
            {hideableIntakeFields.map((field) => (
              <label className="checkbox-label" key={field}>
                <input
                  type="checkbox"
                  checked={intakeFieldVisible(settings, field)}
                  disabled={
                    field === 'description' && settings.descriptionRequired
                  }
                  aria-describedby={
                    field === 'description' && settings.descriptionRequired
                      ? `${prefix}-description-locked`
                      : undefined
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      hiddenFields: e.target.checked
                        ? (settings.hiddenFields ?? []).filter(
                            (f) => f !== field,
                          )
                        : [...(settings.hiddenFields ?? []), field],
                    })
                  }
                />
                {t.visibility.fields[field]}
              </label>
            ))}
          </div>
          <small id={`${prefix}-price-locked`}>
            {t.visibility.priceLocked}
          </small>
          {settings.descriptionRequired && (
            <small id={`${prefix}-description-locked`}>
              {t.visibility.descriptionLocked}
            </small>
          )}
        </fieldset>
        <div className="field">
          <label htmlFor={`${prefix}-template`}>{t.template}</label>
          <input
            id={`${prefix}-template`}
            value={settings.titleTemplate}
            maxLength={240}
            onChange={(e) =>
              setSettings({ ...settings, titleTemplate: e.target.value })
            }
          />
          <small>
            {t.templateHint}{' '}
            <code>
              {'{type} {brand} {size} {color} {condition} {material}'}
            </code>
          </small>
        </div>
        <fieldset>
          <legend>{t.fields}</legend>
          <div className="vocabulary-field-choices">
            {vocabulary.definitions
              .filter(
                (a) =>
                  a.active && !['description', 'category'].includes(a.slug),
              )
              .map((a) => (
                <label className="checkbox-label" key={a.slug}>
                  <input
                    type="checkbox"
                    checked={settings.attributes.includes(a.slug)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        attributes: e.target.checked
                          ? [...settings.attributes, a.slug]
                          : settings.attributes.filter((s) => s !== a.slug),
                      })
                    }
                  />
                  {labelOf(a, locale)}
                </label>
              ))}
          </div>
        </fieldset>
      </fieldset>
      {editable && (
        <Button
          type="button"
          disabled={busy || refused || (!dirty && !locked)}
          onClick={() => void save()}
        >
          {locked ? t.retry : t.save}
        </Button>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
