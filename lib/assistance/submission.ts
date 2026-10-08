import { z } from 'zod'
import type { ReceptionAIConfig } from './reception-config'
import { boundedJson } from '../http/bounded-json'
import {
  approximatePrice,
  submissionInstructions,
  submissionBaseSuggestion,
} from './submission-suggestion'

export async function generateSubmissionSuggestion(
  config: ReceptionAIConfig,
  context: unknown,
  images: string[],
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const response = await transport('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      max_output_tokens: 2500,
      instructions: submissionInstructions,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: JSON.stringify(context) },
            ...images.map((image_url) => ({
              type: 'input_image',
              image_url,
              detail: 'auto',
            })),
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'seller_photo_suggestion',
          strict: true,
          schema: z.toJSONSchema(
            submissionBaseSuggestion.extend({
              approximatePrice: approximatePrice.nullable(),
            }),
          ),
        },
      },
    }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('ASSISTANCE_FAILED')
  }
  const envelope = z
    .object({
      status: z.string(),
      usage: z.object({
        input_tokens: z.number().int().min(0).max(10000000),
        output_tokens: z.number().int().min(0).max(10000000),
      }),
      output: z.array(
        z.object({
          type: z.string(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }))
            .optional(),
        }),
      ),
    })
    .parse(await boundedJson(response, 100000))
  const messages = envelope.output.filter((o) => o.type === 'message')
  let output = null
  if (
    envelope.status === 'completed' &&
    messages.length === 1 &&
    messages[0].content?.length === 1 &&
    messages[0].content[0].type === 'output_text'
  ) {
    try {
      output = submissionBaseSuggestion.parse(
        JSON.parse(messages[0].content[0].text ?? ''),
      )
    } catch {
      /* Preserve usage even for invalid model output. */
    }
  }
  return { output, usage: envelope.usage }
}
