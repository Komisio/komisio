import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ItemHistory } from '../../components/intake/item-history'
import { itemEventKind, itemPriceReason } from '../../lib/engine/items'
import { dictionary, locales } from '../../lib/i18n'

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
