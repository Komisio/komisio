/** Statement dates use the existing Stockholm calendar, independent of the browser timezone. */
const zone = 'Europe/Stockholm'
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
function parseDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid date')
  const value = new Date(`${day}T00:00:00.000Z`)
  if (
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== day
  )
    throw new Error('Invalid date')
  return value
}
function shiftDay(day: string, days: number) {
  const value = parseDay(day)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function statementPeriodDefaults(now = new Date()) {
  const to = shiftDay(dayFormatter.format(now), -1)
  return { from: to.slice(0, 7) + '-01', to }
}
export function statementPeriodDates(
  from: string,
  to: string,
  now = new Date(),
) {
  parseDay(from)
  parseDay(to)
  if (from > to || to >= dayFormatter.format(now))
    throw new Error('Period must contain only closed days')
  return { periodFrom: from, periodTo: to, calendar: 'stockholm-days' as const }
}
