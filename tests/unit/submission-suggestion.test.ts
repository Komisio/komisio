import { describe, it, expect } from 'vitest'
import { validateSubmissionSuggestion } from '../../lib/assistance/submission-suggestion'
import { generateSubmissionSuggestion } from '../../lib/assistance/submission'
const id = 'f0000000-0000-4000-8000-000000000001'
const context = {
  language: 'sv',
  currency: 'SEK',
  evidence: [],
  accepts: '',
  concept: '',
  goods: [],
}
const output = {
  description: 'A blue jacket',
  price: null,
  suitability: 'uncertain',
  reason: 'The store needs to review the item',
}
describe('seller photo assistance', () => {
  it('does not claim fit without store criteria', () => {
    expect(() =>
      validateSubmissionSuggestion(
        { ...output, suitability: 'likely' },
        context,
      ),
    ).toThrow('MISSING_STORE_CRITERIA')
    expect(validateSubmissionSuggestion(output, context)).toEqual(output)
  })
  it('rejects fabricated evidence and ambiguous money', () => {
    const price = { from: '100.00', to: '200.00', evidenceIds: [id] }
    expect(() =>
      validateSubmissionSuggestion({ ...output, price }, context),
    ).toThrow('INVALID_EVIDENCE')
    expect(() =>
      validateSubmissionSuggestion(
        { ...output, price: { ...price, from: 100 } },
        { ...context, evidence: [{ id }] },
      ),
    ).toThrow()
    expect(
      validateSubmissionSuggestion(
        { ...output, price },
        { ...context, evidence: [{ id }] },
      ).price,
    ).toEqual(price)
  })
  it('sends images and store context to a fixed endpoint with structured output', async () => {
    let sent: Record<string, unknown> = {}
    const transport: typeof fetch = async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses')
      sent = JSON.parse(String(init?.body))
      return Response.json({
        status: 'completed',
        usage: { input_tokens: 100, output_tokens: 40 },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(output) }],
          },
        ],
      })
    }
    const result = await generateSubmissionSuggestion(
      { key: 'test', model: 'test-model' },
      context,
      ['data:image/jpeg;base64,fixture'],
      AbortSignal.timeout(1000),
      transport,
    )
    expect(result.output).toEqual(output)
    expect(sent.store).toBe(false)
    expect(sent.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify(context) },
          {
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,fixture',
            detail: 'auto',
          },
        ],
      },
    ])
  })
  it('retains usage on malformed output without fabricating a suggestion', async () => {
    const result = await generateSubmissionSuggestion(
      { key: 'test', model: 'test-model' },
      context,
      [],
      AbortSignal.timeout(1000),
      async () =>
        Response.json({
          status: 'completed',
          usage: { input_tokens: 100, output_tokens: 40 },
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'not JSON' }],
            },
          ],
        }),
    )
    expect(result.output).toBeNull()
    expect(result.usage.output_tokens).toBe(40)
  })
})
