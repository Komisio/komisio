import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SellerLedgerTable } from '../../components/intake/seller-ledger-table'
import { dictionary, locales } from '../../lib/i18n'
import { ledgerKind, type LedgerEntry } from '../../lib/engine/seller-ledger'

const payoutId = '00000000-0000-4000-8000-000000000001'
const itemId = '00000000-0000-4000-8000-000000000002'
const entries: LedgerEntry[] = ledgerKind.options.map((kind, i) => ({
  id: String(i),
  kind,
  amount_ore:
    kind === 'payout_paid' || kind === 'payout_reserved' ? -8000 : 8000,
  reference_kind: kind.startsWith('payout_') ? 'payout' : 'sale_line',
  reference_id: payoutId,
  occurred_at: '2026-10-20T12:30:00Z',
  reason: '',
  itemDetails:
    kind === 'credit_sale'
      ? {
          itemId,
          reference: 'I-00000002',
          title: 'Synthetic <coat>',
          salePriceOre: '20000',
          storeShareOre: '12000',
          sellerShareOre: '8000',
        }
      : null,
}))

it.each(locales)(
  'renders every event, localized headers, signs and payout references in %s',
  (locale) => {
    const d = dictionary(locale)
    const html = renderToStaticMarkup(
      createElement(SellerLedgerTable, { entries, currency: 'DKK', locale, d }),
    )
    expect(html).toContain('role="table"')
    expect(html.match(/scope="col"/g)).toHaveLength(7)
    expect(html.match(/<tr /g)).toHaveLength(entries.length + 1)
    for (const kind of ledgerKind.options)
      expect(html).toContain(d.ledger.kinds[kind])
    expect(html).toContain(d.ledger.table.payoutReference)
    expect(
      html.match(new RegExp(`<code>${payoutId}</code>`, 'g')),
    ).toHaveLength(3)
    expect(html).toContain(`href="/intake/items/${itemId}"`)
    expect(html).toContain('Synthetic &lt;coat&gt;')
    expect(html).toContain('I-00000002')
    const amounts = [...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(
      (match) => match[1],
    )
    expect(amounts).toHaveLength(entries.length)
    expect(amounts.every((amount) => amount.includes('DKK'))).toBe(true)
    expect(amounts.filter((amount) => /[-−]/.test(amount))).toHaveLength(2)
    expect(amounts.filter((amount) => amount.includes('+'))).toHaveLength(
      entries.length - 2,
    )
  },
)

it('retains exact sale amounts and shows sale columns only for sale credits', () => {
  const d = dictionary('en')
  const sale = {
    ...entries[0],
    itemDetails: {
      ...entries[0].itemDetails!,
      salePriceOre: '9007199254740993',
    },
  }
  const html = renderToStaticMarkup(
    createElement(SellerLedgerTable, {
      entries: [sale, { ...entries[1], itemDetails: sale.itemDetails }],
      currency: 'SEK',
      locale: 'en',
      d,
    }),
  )
  expect(html).toContain('90,071,992,547,409.93')
  expect(html).toContain('120.00')
  expect(html.match(/ledger-empty/g)).toHaveLength(3)
  expect(html).not.toContain('Balance after')
})
