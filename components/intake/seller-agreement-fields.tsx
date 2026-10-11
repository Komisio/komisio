'use client'
import { useId, useState } from 'react'
import { agreementPdfUrl } from '@/lib/documents/agreement-pdf-url'
import { localeNames, type Dictionary } from '@/lib/i18n'
import type { SellerAgreement } from '@/lib/engine/intake'

export type AgreementSummary = Pick<
  SellerAgreement,
  'id' | 'title' | 'version' | 'language' | 'translations'
>
export function SellerAgreementFields({
  agreement,
  d,
  accepted = false,
  tenantId,
  sellerId,
  saveWithSeller = true,
}: {
  agreement: AgreementSummary | null
  d: Dictionary['agreements']
  accepted?: boolean
  tenantId: string
  sellerId?: string
  saveWithSeller?: boolean
}) {
  // A background refresh must never change the terms an unchecked/checked form
  // refers to. The engine rejects new approvals if this version is superseded.
  const [base] = useState(agreement)
  const [translationId, setTranslationId] = useState('')
  const [checked, setChecked] = useState(false)
  const id = useId(),
    w = d.workspace
  if (!base) return <p>{d.none}</p>
  return (
    <section className="seller-agreement-fields">
      {!!base.translations?.length && (
        <div className="field">
          <label htmlFor={id + '-language'}>{d.language}</label>
          <select
            id={id + '-language'}
            name="approvalTranslationId"
            value={translationId}
            onChange={(e) => setTranslationId(e.target.value)}
          >
            <option value="">{localeNames[base.language]}</option>
            {base.translations.map((t) => (
              <option key={t.id} value={t.id}>
                {localeNames[t.language]}
              </option>
            ))}
          </select>
        </div>
      )}
      <a
        className="text-link"
        href={agreementPdfUrl({
          tenantId,
          sellerId,
          agreementId: base.id,
          textId: translationId || base.id,
        })}
        download
      >
        {d.pdf.view}
      </a>
      <small>{sellerId ? d.pdf.savedName : d.pdf.afterSave}</small>
      {accepted ? (
        <p>{w.approved}</p>
      ) : (
        <>
          <input type="hidden" name="approvalAgreementId" value={base.id} />
          <label className="intake-confirm">
            <input
              type="checkbox"
              name="agreementApproved"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            {w.approval}
          </label>
          <div className="field" hidden={!checked}>
            <label htmlFor={id + '-reference'}>{w.reference}</label>
            <input
              id={id + '-reference'}
              name="approvalReference"
              required={checked}
              disabled={!checked}
              maxLength={500}
              aria-describedby={id + '-reference-hint'}
            />
            <small id={id + '-reference-hint'}>{w.referenceHint}</small>
            {saveWithSeller && <small>{w.saveHint}</small>}
          </div>
        </>
      )}
    </section>
  )
}
export function approvalFromFields(fields: FormData) {
  return fields.get('agreementApproved') === 'on'
    ? {
        agreementId: String(fields.get('approvalAgreementId') ?? ''),
        reference: String(fields.get('approvalReference') ?? '').trim(),
        ...(fields.get('approvalTranslationId')
          ? { translationId: String(fields.get('approvalTranslationId')) }
          : {}),
      }
    : undefined
}
