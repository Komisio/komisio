import { SellerSection } from '@/components/seller/section'
import type { readMyRegistrations } from '@/lib/engine/seller-registration'
import type { Dictionary } from '@/lib/i18n'

export function MyRegistrations({
  rows,
  d,
  labels,
}: {
  rows: Awaited<ReturnType<typeof readMyRegistrations>>
  d: Dictionary['selfRegistration']
  labels: Dictionary['sellerPortalWorkspace']
}) {
  if (!rows.length) return null
  return (
    <>
      {rows
        .filter((row) => row.state !== 'approved')
        .map((row) => (
          <SellerSection className="card seller-store-card" key={row.id}>
            <h3>{row.storeName}</h3>
            <p>
              <strong>
                {row.state === 'pending' ? labels.pending : labels.rejected}
              </strong>
            </p>
            {row.state === 'pending' && <p>{d.pendingHint}</p>}
            {row.state === 'rejected' && <p>{d.rejectedHint}</p>}
          </SellerSection>
        ))}
    </>
  )
}
