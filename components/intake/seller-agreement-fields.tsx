'use client'
import { useId, useState } from 'react'
import Link from 'next/link'
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
}: {
  agreement: AgreementSummary | null
  d: Dictionary['agreements']
  accepted?: boolean
}) {
  // A background refresh must never change the terms an unchecked/checked form
  // refers to. The engine rejects new approvals if this version is superseded.
  const [base] = useState(agreement)
  const [translationId, setTranslationId] = useState('')
  const [checked, setChecked] = useState(false)
  const id = useId(),
    w = d.workspace
  if (!base) return <p>{d.none}</p>
  const selected =
    base.translations?.find((t) => t.id === translationId) ?? base
  return (
    <section className="seller-agreement-fields">
      <h3>{d.title}</h3>
      <p>
        {selected.title} · {d.version} {base.version} ·{' '}
        {localeNames[selected.language]}
      </p>
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
      <Link
        className="text-link"
        href={`/intake/agreements?version=${base.id}${translationId ? '&translation=' + translationId : ''}#agreement-document`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {w.open} ↗
      </Link>
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
              aria-describedby={id + '-hint'}
            />
            {w.approval}
          </label>
          <small id={id + '-hint'}>{w.approvalHint}</small>
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
            <small>{w.saveHint}</small>
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
