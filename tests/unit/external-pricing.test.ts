import { describe, expect, it } from 'vitest'
import {
  compareSwedishPrices,
  readExternalComparison,
} from '../../lib/assistance/external-pricing'
import { publicSourceUrl } from '../../lib/assistance/external-price-schema'
const source = {
  url: 'https://example.com/items/1',
  title: 'Jacket',
  amount: '100.00',
  condition: 'Used',
  status: 'asking',
  soldAt: null,
  country: 'SE',
  currency: 'SEK',
  priceBasis: 'item_only',
}
const second = {
  ...source,
  url: 'https://example.org/items/2',
  title: 'Similar jacket',
  amount: '200.00',
}
const candidate = {
  from: '100.00',
  to: '200.00',
  basis: 'asking',
  sources: [source, second],
}
function envelope(
  comparison: unknown = candidate,
  opened = [source.url, second.url],
) {
  return {
    status: 'completed',
    usage: { input_tokens: 100, output_tokens: 40 },
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search' },
      },
      ...opened.map((url) => ({
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'open_page', url },
      })),
      {
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify({ comparison }) },
        ],
      },
    ],
  }
}
describe('Swedish external comparisons', () => {
  it('retains dated asking-price provenance only for opened pages', () => {
    const result = readExternalComparison(
      envelope(),
      new Date('2026-10-08T10:00:00Z'),
    )
    expect(result.comparison?.basis).toBe('asking')
    expect(result.comparison?.observedAt).toBe('2026-10-08T10:00:00.000Z')
    expect(result.searchCalls).toBe(1)
    expect(result.usage.input_tokens).toBe(100)
  })
  it('rejects search snippets and invented sources but retains usage', () => {
    const result = readExternalComparison(envelope(candidate, []))
    expect(result.comparison).toBeNull()
    expect(result.searchCalls).toBe(1)
    expect(result.usage.output_tokens).toBe(40)
  })
  it('rejects duplicate tracking URLs and syndicated copies', () => {
    expect(
      readExternalComparison(
        envelope({
          ...candidate,
          sources: [
            source,
            { ...second, url: source.url + '?utm_source=copy' },
          ],
        }),
      ).comparison,
    ).toBeNull()
    expect(
      readExternalComparison(
        envelope({
          ...candidate,
          sources: [source, { ...source, url: second.url }],
        }),
      ).comparison,
    ).toBeNull()
  })
  it('rejects mixed status, currency, bundled prices and stale sales', () => {
    for (const change of [
      { status: 'sold' },
      { currency: 'EUR' },
      { priceBasis: 'includes_fees_or_shipping' },
      { country: 'DE' },
    ])
      expect(
        readExternalComparison(
          envelope({
            ...candidate,
            sources: [source, { ...second, ...change }],
          }),
        ).comparison,
      ).toBeNull()
    expect(
      readExternalComparison(
        envelope({
          ...candidate,
          basis: 'sold',
          sources: [source, second].map((s) => ({
            ...s,
            status: 'sold',
            soldAt: '2020-01-01T00:00:00Z',
          })),
        }),
      ).comparison,
    ).toBeNull()
  })
  it('rejects unsafe source links', () => {
    for (const url of [
      'http://example.com/1',
      'https://127.0.0.1/1',
      'https://localhost/1',
      'https://user:pass@example.com/1',
      'javascript:alert(1)',
      'https://example.local/1',
    ])
      expect(publicSourceUrl(url)).toBe(false)
  })
  it('bounds provider tools and sends item facts without contact details', async () => {
    let sent: Record<string, unknown> = {}
    const result = await compareSwedishPrices(
      { key: 'synthetic', model: 'test-model' },
      'Blue jacket seller@example.com https://private.example.com',
      AbortSignal.timeout(1000),
      async (url, init) => {
        expect(url).toBe('https://api.openai.com/v1/responses')
        sent = JSON.parse(String(init?.body))
        return Response.json(envelope())
      },
      {
        category: 'jacket',
        brand: null,
        model: 'Observed model',
        articleNumber: null,
        material: 'wool',
        size: null,
        condition: 'used',
      },
    )
    expect(sent.max_tool_calls).toBe(4)
    expect(sent.store).toBe(false)
    expect(String(sent.input)).toContain('Observed model')
    expect(String(sent.input)).toContain('wool')
    expect(String(sent.input)).not.toContain('Blue jacket')
    expect(String(sent.input)).not.toContain('@')
    expect(String(sent.input)).not.toContain('https:')
    expect(sent.tools).toEqual([
      {
        type: 'web_search',
        user_location: { type: 'approximate', country: 'SE' },
      },
    ])
    expect(result.comparison).not.toBeNull()
  })
})
