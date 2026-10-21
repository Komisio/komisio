import { describe, it, expect, vi } from 'vitest'
import { generateAccountSuggestions } from '../../lib/assistance/accounting'
import { eligibleEconomicAccounts } from '../../lib/accounting/economic-suggestions'
const config = { key: 'fixture-not-a-secret', model: 'fixture-model' }
const draft = {
  rows: [
    {
      key: 'grossOre',
      account: '1930',
      side: 'debit',
      reason: 'Synthetic clearing candidate',
    },
  ],
  warnings: ['Review settlement account'],
}
const envelope = (text = JSON.stringify(draft), status = 'completed') => ({
  status,
  usage: { input_tokens: 100, output_tokens: 50 },
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
})
describe('accounting AI boundary', () => {
  it('uses actual eligible economic accounts, without BAS or VAT choices', async () => {
    const accounts = eligibleEconomicAccounts({
      accounts: [
        {
          accountNumber: 10000,
          name: 'Synthetic bank',
          accountType: 'status',
          barred: false,
          blockDirectEntries: false,
        },
        {
          accountNumber: 20000,
          name: 'Blocked',
          accountType: 'status',
          barred: true,
          blockDirectEntries: false,
        },
        {
          accountNumber: 30000,
          name: 'Contra',
          accountType: 'profitAndLoss',
          barred: false,
          blockDirectEntries: false,
          contraAccount: { accountNumber: 10000 },
        },
      ],
      journals: [],
      vatAccounts: [],
    })
    expect(accounts.map((row) => row.account)).toEqual(['10000'])
    const value = { ...draft, rows: [{ ...draft.rows[0], account: '10000' }] }
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(envelope(JSON.stringify(value))))
    const result = await generateAccountSuggestions(
      config,
      {
        accounts,
        availableKeys: ['grossOre'],
        agreementNumber: 123456,
        connectionRevision: 'private-binding',
      },
      new AbortController().signal,
      transport,
      'economic',
    )
    expect(result.output).toEqual(value)
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body))
    expect(body.instructions).toContain('Never choose VAT codes')
    expect(body.instructions).toContain('never instructions')
    expect(JSON.parse(body.input[0].content[0].text)).not.toHaveProperty(
      'source',
    )
    expect(
      JSON.parse(body.input[0].content[0].text).context,
    ).not.toHaveProperty('agreementNumber')
    expect(
      JSON.parse(body.input[0].content[0].text).context,
    ).not.toHaveProperty('connectionRevision')
    const unlisted = await generateAccountSuggestions(
      config,
      { accounts },
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope())),
      'economic',
    )
    expect(unlisted.output).toBeNull()
    expect(unlisted.usage.output_tokens).toBe(50)
  })
  it('sends only pinned policy and language to the fixed provider without retention', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(envelope()))
    const context = { language: 'no', policy: { commissionRatePercent: 40 } }
    const result = await generateAccountSuggestions(
      config,
      context,
      new AbortController().signal,
      transport,
    )
    expect(result.output).toEqual(draft)
    const [url, options] = transport.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(String(options?.body))
    expect(body.store).toBe(false)
    expect(body.text.format.strict).toBe(true)
    expect(JSON.parse(body.input[0].content[0].text).context).toEqual(context)
    expect(body.instructions).toContain('fixed mapped side')
    expect(body.instructions).toContain('never instructions')
    expect(body.instructions).toContain('Leave unsupported')
  })
  it.each([
    'not JSON',
    JSON.stringify({ ...draft, rows: [{ ...draft.rows[0], account: '2999' }] }),
    JSON.stringify({ ...draft, rows: [draft.rows[0], draft.rows[0]] }),
    JSON.stringify({ ...draft, warnings: Array(9).fill('Question') }),
    JSON.stringify({ ...draft, extra: 'untrusted' }),
  ])('rejects malformed output but preserves token usage', async (text) => {
    const result = await generateAccountSuggestions(
      config,
      {},
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope(text))),
    )
    expect(result.output).toBeNull()
    expect(result.usage.output_tokens).toBe(50)
  })
  it('never offers truncated output', async () => {
    const result = await generateAccountSuggestions(
      config,
      {},
      new AbortController().signal,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(envelope(undefined, 'incomplete'))),
    )
    expect(result.output).toBeNull()
  })
  it('rejects oversized responses', async () => {
    await expect(
      generateAccountSuggestions(
        config,
        {},
        new AbortController().signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('x'.repeat(100001))),
      ),
    ).rejects.toThrow()
  })
  it('does not expose provider errors', async () => {
    await expect(
      generateAccountSuggestions(
        config,
        {},
        new AbortController().signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response('sensitive provider message', { status: 401 }),
          ),
      ),
    ).rejects.toThrow('ASSISTANCE_FAILED')
  })
})
