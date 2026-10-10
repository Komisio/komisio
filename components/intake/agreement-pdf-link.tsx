'use client'
import { useId, useState } from 'react'
import { localeNames, type Dictionary } from '@/lib/i18n'
import type { AgreementSummary } from './seller-agreement-fields'

import { agreementPdfUrl } from '@/lib/documents/agreement-pdf-url'

export function SellerAgreementPdf({
  tenantId,
  sellerId,
  agreement,
  d,
  initialText,
}: {
  tenantId: string
  sellerId: string
  agreement: AgreementSummary
  d: Dictionary['agreements']
  initialText?: string | null
}) {
  const [text, setText] = useState(initialText || agreement.id)
  const id = useId()
  return (
    <div className="intake-form no-print">
      {!!agreement.translations?.length && (
        <div className="field">
          <label htmlFor={id}>{d.pdf.language}</label>
          <select
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            <option value={agreement.id}>
              {localeNames[agreement.language]}
            </option>
            {agreement.translations.map((t) => (
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
          agreementId: agreement.id,
          textId: text,
        })}
        download
      >
        {d.pdf.personal}
      </a>
    </div>
  )
}
