// Loaded only by the dedicated local browser test process, never by application imports.
if (
  process.env.KOMISIO_TEST_AI_HTTP_FIXTURE !== 'enabled' ||
  process.env.KOMISIO_RECEPTION_AI_KEY !== 'komisio-http-fixture-not-a-key' ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3000' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
)
  throw new Error('Provider fixture requires isolated local configuration')
const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (url === 'https://api.openai.com/v1/responses') {
    const body = JSON.parse(init.body)
    if (
      body.model !== 'komisio-http-fixture' ||
      init.headers.Authorization !== 'Bearer komisio-http-fixture-not-a-key'
    )
      throw new Error('Fixture configuration mismatch')
    const { sources } = JSON.parse(body.input[0].content[0].text),
      observation = sources.find((s) => s.kind === 'observation'),
      pricing = sources.find((s) => s.kind === 'price-evidence')
    const candidate = {
      metadata: {
        description: observation
          ? {
              value: 'HTTP FIXTURE – blue jacket, not live AI',
              sourceIds: [observation.id],
              certainty: 'observed',
            }
          : null,
        category: null,
        color: null,
        brand: null,
        size: null,
        material: null,
        condition: null,
      },
      price: pricing
        ? {
            currency: 'SEK',
            amount: '250.00',
            sourceIds: [pricing.id],
            rationale: 'HTTP FIXTURE – synthetic appraisal only',
          }
        : null,
      questions: [],
    }
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(candidate) }],
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('External network blocked by local AI fixture')
  return original(input, init)
}
