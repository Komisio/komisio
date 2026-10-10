'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
import type { SellerAgreement } from '@/lib/engine/intake'
import { useIntakeAction } from './use-intake-action'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'

export function AgreementTranslationPublisher({
  tenantId,
  agreement,
  d,
}: {
  tenantId: string
  agreement: SellerAgreement
  d: Dictionary
}) {
  const [base, setBase] = useState(agreement)
  const [saved, setSaved] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(form)
  const action = useIntakeAction(d.intake)
  const router = useRouter()
  const a = d.agreements,
    t = a.translations
  const available = locales.filter(
    (l) =>
      l !== base.language && !base.translations?.some((v) => v.language === l),
  )
  useUnsavedChanges(!saved && (dirty || action.locked) ? d.leaveUnsaved : null)
  if (!available.length) return null
  return (
    <details className="card intake-form no-print agreement-translations">
      <summary>{t.add}</summary>
      <p>{t.hint}</p>
      <p>
        {base.title} · {a.version} {base.version}
      </p>
      {saved ? (
        <div role="status">
          <p>{t.published}</p>
          <Button
            onClick={() => {
              setBase(agreement)
              setSaved(false)
              resetDirty()
            }}
          >
            {t.add}
          </Button>
        </div>
      ) : (
        <form
          ref={form}
          onChange={checkDirty}
          onSubmit={async (event) => {
            event.preventDefault()
            const fields = new FormData(event.currentTarget)
            const id = await action.run({
              action: 'publishAgreementTranslation',
              tenantId,
              requestId: crypto.randomUUID(),
              agreementId: base.id,
              title: fields.get('title'),
              body: fields.get('body'),
              language: fields.get('language'),
            })
            if (id) {
              setSaved(true)
              resetDirty()
              router.refresh()
            }
          }}
        >
          <fieldset
            className="intake-fields"
            disabled={
              !ready || action.busy || action.locked || action.needsReload
            }
            data-draft-readiness={!ready ? '' : undefined}
          >
            <div className="field">
              <label htmlFor="translation-language">{a.language}</label>
              <select id="translation-language" name="language">
                {available.map((l) => (
                  <option key={l} value={l}>
                    {localeNames[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="translation-title">{a.name}</label>
              <input
                id="translation-title"
                name="title"
                required
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor="translation-body">{a.body}</label>
              <textarea
                id="translation-body"
                name="body"
                required
                maxLength={12000}
                rows={10}
              />
            </div>
          </fieldset>
          {action.error && <p role="alert">{action.error}</p>}
          {action.needsReload && (
            <a href="/intake/agreements">{d.intake.reload}</a>
          )}
          <Button
            type="submit"
            disabled={!ready || action.busy || action.needsReload}
          >
            {action.busy
              ? d.intake.busy
              : action.locked
                ? d.intake.retry
                : t.publish}
          </Button>
        </form>
      )}
    </details>
  )
}
