'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { SellerAgreement } from '@/lib/engine/intake'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

export function AgreementPublisher({
  tenantId,
  current,
  d,
}: {
  tenantId: string
  current: SellerAgreement | null
  d: Dictionary
}) {
  const action = useIntakeAction(d.intake)
  const [saved, setSaved] = useState(false)
  // Keep the reviewed base while editing, even if navigation refreshes server props.
  const [base, setBase] = useState(current)
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
      language: fields.get('language') ?? 'sv',
      required: fields.get('required') === 'on',
    })
    if (id) {
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <section className="card intake-form">
      <h2>{a.publishHeading}</h2>
      <p>{a.publishHint}</p>
      {saved ? (
        <div role="status">
          <p>{a.published}</p>
          <Button
            onClick={() => {
              setBase(current)
              setSaved(false)
            }}
          >
            {a.nextVersion}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset
            className="intake-fields"
            disabled={action.busy || action.locked}
          >
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
                defaultValue={base?.language ?? 'sv'}
              >
                <option value="sv">Svenska</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="agreement-body">{a.body}</label>
              <textarea
                id="agreement-body"
                name="body"
                rows={10}
                required
                maxLength={12000}
                defaultValue={base?.body ?? ''}
              />
              <small>{a.languageHint}</small>
            </div>
            <label className="intake-confirm">
              <input
                type="checkbox"
                name="required"
                defaultChecked={base?.required_before_receipt ?? false}
              />
              {a.requireEvidence}
            </label>
            <label className="intake-confirm">
              <input type="checkbox" required />
              {a.confirmPublish}
            </label>
          </fieldset>
          {action.error && <p role="alert">{action.error}</p>}
          {action.needsReload && (
            <a className="text-link" href="/intake/agreements">
              {d.intake.reload}
            </a>
          )}
          <Button type="submit" disabled={action.busy || action.needsReload}>
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
  d,
}: {
  tenantId: string
  sellerId: string
  agreementId: string
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
