'use client'

import { useState } from 'react'
import { WorkingForm } from '@/components/platform/working-form'
import { economyFormat } from '@/lib/intake/economy-format'
import type { Dictionary, Locale } from '@/lib/i18n'

/** Localized, validated date entry; the read API continues receiving ISO dates. */
export function EconomyPeriodForm({
  from,
  to,
  locale,
  brief,
  invalid,
  t,
}: {
  from: string
  to: string
  locale: Locale
  brief?: string
  invalid: boolean
  t: Dictionary['economy']
}) {
  const format = economyFormat(locale)
  return (
    <WorkingForm className="economy-period-form" data-workspace-filter>
      {brief && <input type="hidden" name="brief" value={brief} />}
      {invalid && <p role="alert">{t.periodInvalid}</p>}
      <PeriodDate
        name="from"
        label={t.from}
        initial={from}
        locale={locale}
        error={t.dateInvalid}
      />
      <PeriodDate
        name="to"
        label={t.to}
        initial={to}
        locale={locale}
        error={t.dateInvalid}
      />
      <button className="btn btn-primary">{t.show}</button>
      <p className="muted economy-date-hint">
        {t.dateExample.replace('{date}', format.date('2026-10-01'))}
      </p>
    </WorkingForm>
  )
}

function PeriodDate({
  name,
  label,
  initial,
  locale,
  error,
}: {
  name: string
  label: string
  initial: string
  locale: Locale
  error: string
}) {
  const format = economyFormat(locale)
  const [value, setValue] = useState(format.date(initial))
  const iso = format.parseDate(value)
  return (
    <div className="field">
      <label htmlFor={`economy-${name}`}>{label}</label>
      <input
        id={`economy-${name}`}
        type="text"
        value={value}
        required
        aria-describedby={`economy-${name}-hint`}
        onChange={(event) => {
          setValue(event.target.value)
          event.target.setCustomValidity(
            format.parseDate(event.target.value) ? '' : error,
          )
        }}
      />
      <span id={`economy-${name}-hint`} className="sr-only">
        {format.date('2026-10-01')}
      </span>
      <input type="hidden" name={name} value={iso ?? ''} />
    </div>
  )
}
