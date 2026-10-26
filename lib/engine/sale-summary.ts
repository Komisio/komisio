import type { SupabaseClient } from '@supabase/supabase-js'
import { readSale } from './sales'
import { readReturnsForLines } from './returns'
import { readItemLabel } from './item-label'
import { readStoreProfile } from './store-profile'
import { labelAttributeLines } from '../labels/item-attributes'
import type { Locale } from '../i18n'

/** An allowlist for customer-facing output. Never pass raw sale/item records to PDF. */
export type SaleSummary = {
  id: string
  storeName: string
  address: string
  locale: Locale
  occurredAt: string
  generatedAt: string
  reference: string
  currency: string
  status: 'completed' | 'reversed'
  totalOre: string
  lines: {
    reference: string
    title: string
    attributes: string[]
    priceOre: string
    returned: { occurredAt: string; amountOre: string } | null
  }[]
}

export async function readSaleSummary(
  client: SupabaseClient,
  tenant: { id: string; name: string },
  saleId: string,
  fallbackLocale: Locale,
): Promise<SaleSummary | null> {
  const result = await readSale(client, tenant.id, saleId)
  if (!result) return null
  const [profile, returns] = await Promise.all([
    readStoreProfile(client, tenant.id),
    readReturnsForLines(
      client,
      tenant.id,
      result.lines.map((line) => line.id),
    ),
  ])
  const locale = profile.profile?.language ?? fallbackLocale
  const labels = new Map<string, Awaited<ReturnType<typeof readItemLabel>>>()
  // Bound concurrent reads; even a fifty-line purchase must not flood PostgREST.
  for (let offset = 0; offset < result.lines.length; offset += 8) {
    await Promise.all(
      result.lines.slice(offset, offset + 8).map(async (line) => {
        labels.set(
          line.item_id,
          await readItemLabel(client, tenant.id, line.item_id),
        )
      }),
    )
  }
  const sale = result.sale
  const address = profile.profile?.address
  return {
    id: sale.id,
    storeName: tenant.name,
    address: address
      ? [
          address.street,
          [address.postalCode, address.city].filter(Boolean).join(' '),
          address.country,
        ]
          .filter(Boolean)
          .join(', ')
      : '',
    locale,
    occurredAt: sale.occurred_at,
    generatedAt: new Date().toISOString(),
    reference: sale.external_id,
    currency: sale.currency,
    status: sale.status,
    totalOre: String(sale.total_ore),
    lines: result.lines.map((line) => {
      const label = labels.get(line.item_id)
      const returned = returns.get(line.id)
      return {
        reference: `I-${line.item_id.slice(0, 8).toUpperCase()}`,
        title: label?.title ?? '',
        attributes: labelAttributeLines(label?.attributes, locale),
        // Label facts contain today's price: deliberately use the frozen sale line.
        priceOre: String(line.price_ore),
        returned: returned
          ? {
              occurredAt: returned.occurred_at,
              amountOre: String(returned.refund_ore),
            }
          : null,
      }
    }),
  }
}
