import type { readMyRegistrations } from '@/lib/engine/seller-registration'
import type { Dictionary } from '@/lib/i18n'

export function MyRegistrations({
  rows,
  d,
}: {
  rows: Awaited<ReturnType<typeof readMyRegistrations>>
  d: Dictionary['selfRegistration']
}) {
  if (!rows.length) return null
  return (
    <section className="card" aria-label={d.queue}>
      <h2>{d.queue}</h2>
      {rows.map((row) => (
        <div key={row.id}>
          <h3>{row.storeName}</h3>
          <p>
            <strong>{d[row.state]}</strong>
          </p>
          {row.state === 'pending' && <p>{d.pendingHint}</p>}
          {row.state === 'rejected' && <p>{d.rejectedHint}</p>}
        </div>
      ))}
    </section>
  )
}
