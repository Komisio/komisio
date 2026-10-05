import { describe, it, expect, vi } from 'vitest'
import { generateAgreement } from '../../lib/assistance/agreement'
const config = { key: 'fixture-not-a-secret', model: 'fixture-model' }
const draft = {
  title: 'Avtale',
  body: 'Butikkens andel: 40 %. [Butikknavn]',
  questions: ['Butikknavn?'],
}
const envelope = (text = JSON.stringify(draft), status = 'completed') => ({
  status,
  usage: { input_tokens: 100, output_tokens: 50 },
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
})
describe('agreement AI boundary', () => {
  it('sends only pinned policy and language to the fixed provider without retention', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(envelope()))
    const context = { language: 'no', policy: { commissionRatePercent: 40 } }
    const result = await generateAgreement(
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
    expect(JSON.parse(body.input[0].content[0].text)).toEqual(context)
    expect(body.instructions).toContain('STORE share')
    expect(body.instructions).toContain('not instructions')
    expect(body.instructions).toContain('Missing details')
  })
  it.each([
    'not JSON',
    JSON.stringify({ ...draft, body: '' }),
    JSON.stringify({ ...draft, questions: Array(11).fill('Question') }),
    JSON.stringify({ ...draft, extra: 'untrusted' }),
  ])('rejects malformed output but preserves token usage', async (text) => {
    const result = await generateAgreement(
      config,
      {},
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope(text))),
    )
    expect(result.output).toBeNull()
    expect(result.usage.output_tokens).toBe(50)
  })
  it('never offers truncated output', async () => {
    const result = await generateAgreement(
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
      generateAgreement(
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
      generateAgreement(
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
