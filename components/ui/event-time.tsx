import { intlLocale } from '@/lib/i18n'

/** Compact event display; the original instant remains in the time element. */
export function EventTime({
  value,
  locale,
}: {
  value: string
  locale: string
}) {
  const date = new Date(value)
  const language = intlLocale(locale)
  return (
    <time
      dateTime={value}
      title={date.toLocaleString(language, { timeZone: 'Europe/Stockholm' })}
    >
      {date.toLocaleString(language, {
        timeZone: 'Europe/Stockholm',
        dateStyle: 'medium',
        timeStyle: 'short',
      })}
    </time>
  )
}
