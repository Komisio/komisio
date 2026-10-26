import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ItemHistory } from '../../components/intake/item-history'
import { itemEventKind, itemPriceReason } from '../../lib/engine/items'
import { dictionary, locales } from '../../lib/i18n'
import { economyFormat } from '../../lib/intake/economy-format'

it('keeps the shared kind and reason lists aligned with the latest database constraints', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n')
  for (const [constraint, column, options] of [
    ['item_events_kind_check', 'kind', itemEventKind.options],
    ['item_prices_reason_check', 'reason', itemPriceReason.options],
  ] as const) {
    const matches = [
      ...sql.matchAll(
        new RegExp(
          `add\\s+constraint\\s+${constraint}\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]+)\\)`,
          'gi',
        ),
      ),
    ]
    expect(matches.length).toBeGreaterThan(0)
    const values = [...matches.at(-1)![1].matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    )
    expect([...options].sort()).toEqual(values.sort())
  }
})

it.each(locales)(
  'renders every item event and price reason with a label in %s',
  (locale) => {
    const d = dictionary(locale).items,
      stamp = '2026-10-23T08:00:00Z'
    const events = itemEventKind.options.map((kind, i) => ({
      id: `event-${i}`,
      kind,
      detail: {},
      occurred_at: stamp,
    }))
    const prices = itemPriceReason.options.map((reason, i) => ({
      id: `price-${i}`,
      reason,
      price_ore: 20000,
      set_at: stamp,
    }))
    const html = renderToStaticMarkup(
      createElement(ItemHistory, {
        events,
        prices,
        currency: 'DKK',
        locale,
        d,
      }),
    )
    for (const kind of itemEventKind.options) {
      expect(d.eventKinds[kind].trim()).not.toBe('')
      expect(d.eventKinds[kind]).not.toBe(kind)
      expect(html).toContain(`<strong>${d.eventKinds[kind]}</strong>`)
    }
    for (const reason of itemPriceReason.options) {
      expect(d.priceReasons[reason].trim()).not.toBe('')
      expect(d.priceReasons[reason]).not.toBe(reason)
      expect(html).toContain(`<span>${d.priceReasons[reason]}</span>`)
    }
    expect(html.match(/<li>/g)).toHaveLength(events.length + prices.length)
  },
)

it.each(locales)(
  'shows recorded lifecycle details without exposing arbitrary metadata in %s',
  (locale) => {
    const d = dictionary(locale).items
    const events = [
      {
        id: 'end',
        kind: 'period_ended' as const,
        detail: {
          action: 'return',
          note: '<b>Collection arranged</b>',
          privateToken: 'DO_NOT_RENDER',
        },
      },
      {
        id: 'extend',
        kind: 'period_extended' as const,
        detail: { days: 7, reason: 'Synthetic extension' },
      },
      {
        id: 'price',
        kind: 'price_set' as const,
        detail: {
          previousPriceOre: 25000,
          priceOre: '20000',
          reason: 'Synthetic price',
        },
      },
      {
        id: 'old',
        kind: 'markdown_applied' as const,
        detail: { priceOre: 18000 },
      },
      { id: 'return', kind: 'returned' as const, detail: {} },
      {
        id: 'correction',
        kind: 'period_end_corrected' as const,
        detail: {
          action: 'return',
          previousAction: 'charity',
          reason: 'Synthetic end correction',
        },
      },
      {
        id: 'reopen',
        kind: 'period_reopened' as const,
        detail: { saleEndsOn: '2027-04-01', reason: 'Synthetic reopening' },
      },
      {
        id: 'collection',
        kind: 'collection_recorded' as const,
        detail: {
          endEventId: '11111111-1111-4111-8111-111111111111',
          collected: false,
          observedOn: '2026-10-26',
          note: 'Synthetic collection check',
        },
      },
    ].map((e) => ({ ...e, occurred_at: '2026-10-26T09:00:00Z' }))
    const html = renderToStaticMarkup(
      createElement(ItemHistory, {
        events,
        prices: [],
        currency: 'DKK',
        locale,
        d,
      }),
    )
    expect(html).toContain(d.eventDetails.actions.return)
    expect(html).toContain('&lt;b&gt;Collection arranged&lt;/b&gt;')
    expect(html).toContain(d.eventDetails.days)
    expect(html).toContain('<dd>7</dd>')
    expect(html).toContain('Synthetic extension')
    const money = economyFormat(locale).money
    expect(html).toContain(`${money(25000, 'DKK')} → ${money(20000, 'DKK')}`)
    expect(html).toContain(money(18000, 'DKK'))
    expect(html.match(/→/g)).toHaveLength(1)
    expect(html).toContain(`<strong>${d.eventKinds.returned}</strong>`)
    expect(html).not.toContain('DO_NOT_RENDER')
    expect(html).toContain(d.eventDetails.notCollected)
    expect(html).toContain(economyFormat(locale).date('2026-10-26'))
    expect(html).toContain('Synthetic collection check')
    expect(html).toContain(d.eventDetails.previousAction)
    expect(html).toContain('Synthetic end correction')
    expect(html).toContain(economyFormat(locale).date('2027-04-01'))
    expect(html).toContain('Synthetic reopening')
  },
)

it('does not infer old prices or render invalid numeric facts', () => {
  const d = dictionary('sv').items
  const html = renderToStaticMarkup(
    createElement(ItemHistory, {
      prices: [],
      currency: 'SEK',
      locale: 'sv',
      d,
      events: [
        {
          id: 'bad',
          kind: 'price_set',
          detail: { priceOre: { secret: 'hidden' }, previousPriceOre: true },
          occurred_at: '2026-10-26T09:00:00Z',
        },
      ],
    }),
  )
  expect(html).not.toContain('item-event-details')
  expect(html).not.toContain('hidden')
})
