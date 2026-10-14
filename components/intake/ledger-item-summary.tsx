import { z } from 'zod'
import { ledgerItemDetails } from '@/lib/engine/seller-ledger'
import { formatOre } from '@/lib/engine/items'
import type { Dictionary } from '@/lib/i18n'
export function LedgerItemSummary({
  details,
  currency,
  d,
}: {
  details: z.infer<typeof ledgerItemDetails>
  currency: string
  d: Dictionary
}) {
  return (
    <small style={{ display: 'block' }}>
      {d.itemWorkflow.storeShare}: {formatOre(details.storeShareOre)} {currency}{' '}
      · {d.itemWorkflow.sellerShare}: {formatOre(details.sellerShareOre)}{' '}
      {currency}
    </small>
  )
}
