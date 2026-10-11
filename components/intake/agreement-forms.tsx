'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { locales, localeNames, type Dictionary, type Locale } from '@/lib/i18n'
import type { SellerAgreement } from '@/lib/engine/intake'
import { useIntakeAction } from './use-intake-action'
import { AgreementPreview, readAgreementPreview } from './agreement-preview'
import { AgreementAssistant } from './agreement-assistant'
import type { RestoredAgreementDraft } from '@/lib/engine/agreement-assistance'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

export function AgreementPublisher({
  tenantId,
  current,
  draft,
  locale,
  d,
}: {
  tenantId: string
  current: SellerAgreement | null
  draft: RestoredAgreementDraft | null
  locale: Locale
  d: Dictionary
}) {
  const action = useIntakeAction(d.intake)
  const [aiBusy, setAiBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(form)
  useUnsavedChanges(!saved && (dirty || action.locked) ? d.leaveUnsaved : null)
  // Keep the reviewed base while editing, even if navigation refreshes server props.
  const [base, setBase] = useState(current)
  const [preview, setPreview] = useState({
    title: current?.title ?? '',
    body: current?.body ?? '',
    language: current?.language ?? locale,
  })
  const router = useRouter()
  const a = d.agreements
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      fields = new FormData(form)
    setSaved(false)
    const id = await action.run({
      action: 'publishAgreement',
      tenantId,
      requestId: crypto.randomUUID(),
      expectedCurrentId: base?.id ?? null,
      title: fields.get('title') ?? '',
      body: fields.get('body') ?? '',
      language: fields.get('language') ?? locale,
      required: fields.get('required') === 'on',
    })
    if (id) {
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <section
      className="card intake-form agreement-publisher"
      data-testid="agreement-publisher"
    >
      <FormHelpHeading
        title={base ? a.nextVersion : a.publishHeading}
        help={{
          label: a.usage.checklistLabel,
          steps: [a.usage.checklist1, a.usage.checklist2, a.ai.hint],
        }}
      />

      {!saved && (
        <p className="agreement-editor-context">
          {base ? a.editor.newVersionHint : a.editor.firstVersionHint}
        </p>
      )}
      {saved ? (
        <div role="status">
          <p>{a.published}</p>
          <p>
            <a
              className="text-link"
              href="/intake/agreements#agreements-languages"
            >
              {a.workspace.manageLanguages}
            </a>
          </p>
          <Button
            onClick={() => {
              setBase(current)
              setPreview({
                title: current?.title ?? '',
                body: current?.body ?? '',
                language: current?.language ?? locale,
              })
              setSaved(false)
              resetDirty()
            }}
          >
            {a.nextVersion}
          </Button>
        </div>
      ) : (
        <form
          ref={form}
          onChange={() => {
            checkDirty()
            if (form.current) setPreview(readAgreementPreview(form.current))
          }}
          onSubmit={submit}
        >
          <fieldset
            data-draft-readiness={!ready ? '' : undefined}
            className="intake-fields"
            disabled={!ready || action.busy || action.locked || aiBusy}
          >
            <div className="agreement-editor-meta">
              <div className="field">
                <label htmlFor="agreement-title">{a.name}</label>
                <input
                  id="agreement-title"
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={base?.title ?? ''}
                />
              </div>
              <div className="field">
                <label htmlFor="agreement-language">{a.language}</label>
                <select
                  id="agreement-language"
                  name="language"
                  defaultValue={base?.language ?? locale}
                >
                  {locales.map((language) => (
                    <option key={language} value={language}>
                      {localeNames[language]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="agreement-editor-columns">
              <div className="field">
                <label htmlFor="agreement-body">{a.body}</label>
                <textarea
                  id="agreement-body"
                  name="body"
                  rows={18}
                  required
                  maxLength={12000}
                  defaultValue={base?.body ?? ''}
                />
              </div>
              <AgreementPreview text={preview} labels={a.editor} />
            </div>
            <label className="intake-confirm">
              <input
                type="checkbox"
                name="required"
                defaultChecked={base?.required_before_receipt ?? false}
              />
              {a.requireEvidence}
            </label>
          </fieldset>
          <details className="agreement-ai-disclosure">
            <summary>{a.ai.create}</summary>
            <AgreementAssistant
              tenantId={tenantId}
              baseId={base?.id ?? null}
              d={a.ai}
              busyChanged={setAiBusy}
              initial={draft}
              disabled={
                !ready || action.busy || action.locked || action.needsReload
              }
              language={() =>
                (new FormData(form.current!).get('language') ??
                  locale) as Locale
              }
              hasText={() =>
                !!(
                  form.current?.elements.namedItem(
                    'body',
                  ) as HTMLTextAreaElement | null
                )?.value.trim()
              }
              apply={(draft, language) => {
                if (!form.current) return
                ;(
                  form.current.elements.namedItem('title') as HTMLInputElement
                ).value = draft.title
                ;(
                  form.current.elements.namedItem('body') as HTMLTextAreaElement
                ).value = draft.body
                ;(
                  form.current.elements.namedItem(
                    'language',
                  ) as HTMLSelectElement
                ).value = language
                setPreview({ title: draft.title, body: draft.body, language })
                checkDirty()
              }}
            />
          </details>
          {action.error && <p role="alert">{action.error}</p>}
          {action.needsReload && (
            <a className="text-link" href="/intake/agreements">
              {d.intake.reload}
            </a>
          )}
          <Button
            type="submit"
            disabled={!ready || action.busy || action.needsReload || aiBusy}
          >
            {action.busy
              ? d.intake.busy
              : action.locked
                ? d.intake.retry
                : a.publish}
          </Button>
        </form>
      )}
    </section>
  )
}

export function EvidenceRecorder({
  tenantId,
  sellerId,
  agreementId,
  agreement,
  d,
}: {
  tenantId: string
  sellerId: string
  agreementId: string
  agreement?: Pick<SellerAgreement, 'language' | 'translations'>
  d: Dictionary
}) {
  const action = useIntakeAction(d.intake)
  const router = useRouter()
  const [saved, setSaved] = useState(false)
  const a = d.agreements
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      fields = new FormData(form)
    setSaved(false)
    const id = await action.run({
      action: 'recordEvidence',
      tenantId,
      requestId: crypto.randomUUID(),
      sellerId,
      agreementId,
      reference: fields.get('reference') ?? '',
      ...(fields.get('translationId')
        ? { translationId: fields.get('translationId') }
        : {}),
    })
    if (id) {
      setSaved(true)
      form.reset()
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit} className="agreement-evidence-form">
      <p>{a.evidenceHint}</p>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked}
      >
        <div className="field">
          {!!agreement?.translations?.length && (
            <>
              <label htmlFor="evidence-language">{a.language}</label>
              <select id="evidence-language" name="translationId">
                <option value="">{localeNames[agreement.language]}</option>
                {agreement.translations.map((t) => (
                  <option key={t.id} value={t.id}>
                    {localeNames[t.language]}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="evidence-reference">{a.reference}</label>
          <input
            id="evidence-reference"
            name="reference"
            required
            maxLength={500}
          />
          <small>{a.referenceHint}</small>
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {a.confirmEvidence}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <a className="text-link" href={`/intake?seller=${sellerId}`}>
          {d.intake.reload}
        </a>
      )}
      <Button type="submit" disabled={action.busy || action.needsReload}>
        {action.busy
          ? d.intake.busy
          : action.locked
            ? d.intake.retry
            : a.record}
      </Button>
      {saved && <p role="status">{a.recorded}</p>}
    </form>
  )
}
