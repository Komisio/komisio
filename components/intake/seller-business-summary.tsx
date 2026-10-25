import type { Dictionary } from '@/lib/i18n'
import type { BusinessDetails } from '@/lib/engine/seller-business'

/** Read-only identity; internal profile notes are never passed here. */
export function SellerBusinessSummary({
  business,
  d,
}: {
  business?: BusinessDetails | null
  d: Dictionary['sellerDetails']['business']
}) {
  return (
    <section className="card">
      <h2>{d.business}</h2>
      <dl>
        {(
          [
            'companyName',
            'organisationNumber',
            'vatNumber',
            'contactPerson',
            'billingAddress',
            'invoiceEmail',
            'invoiceReference',
          ] as const
        ).map((key) =>
          business?.[key] ? (
            <div key={key}>
              <dt>{d[key]}</dt>
              <dd>{business[key]}</dd>
            </div>
          ) : null,
        )}
      </dl>
      <p>
        {d.vatRegistered}: {business?.vatRegistered ? d.yes : d.no}
      </p>
    </section>
  )
}
