import type { PayoutSource } from '@/lib/engine/accounting'
import type { Dictionary } from '@/lib/i18n'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'

export function PayoutEvidence({
  sources,
  currency,
  d,
}: {
  sources?: PayoutSource[] | null
  currency: string
  d: Dictionary['accounting']
}) {
  if (!sources?.length) return null
  const t = d.payoutEvidence
  return (
    <details className="accounting-breakdown">
      <summary>
        {t.title} ({sources.length})
      </summary>
      <ul className="stack">
        {sources.map((p) => (
          <li key={p.payoutId}>
            <p>
              {formatSignedOre(p.amountOre)} {currency} · {t.reference}:{' '}
              {p.reference}
            </p>
            <p>
              {t.payoutId}: {p.payoutId}
            </p>
            <p>
              {t.sellerId}:{' '}
              <Link
                className="text-link"
                href={`/intake/sellers/${p.sellerId}`}
              >
                {p.sellerId}
              </Link>
            </p>
            <p>
              {t.paidAt}: <time dateTime={p.paidAt}>{p.paidAt}</time>
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
