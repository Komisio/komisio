import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runExternalPhotoAnalysis } from '../../lib/engine/external-photo-assistance'
import { generateExternalPhotoSuggestion } from '../../lib/assistance/external-photo'

const id = (n: number) =>
  `f4780000-0000-4000-8000-${String(n).padStart(12, '0')}`
const command = {
  action: 'analyze',
  requestId: id(1),
  tenantId: id(2),
  photos: [id(3), id(4)],
  language: 'sv',
}
const output = {
  description: 'Dress',
  brand: null,
  condition: 'good',
  notes: '',
}
const pending = {
  id: id(1),
  tenantId: id(2),
  photos: command.photos,
  language: 'sv',
  status: 'pending',
  output: null,
}
const env = {
  KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
  KOMISIO_RECEPTION_AI_KEY: 'synthetic-key',
  KOMISIO_RECEPTION_AI_MODEL: 'synthetic-model',
}
function fixture(existing: unknown = null) {
  let result = existing
  const bytes = Buffer.from('synthetic-jpeg'),
    digest = createHash('sha256').update(bytes).digest('hex')
  const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }))
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'my_external_photo_analysis')
      return { data: result, error: null }
    if (name === 'external_photo_ai_configuration')
      return { data: { own: null }, error: null }
    if (name === 'begin_external_photo_analysis')
      return {
        data: {
          reserved: true,
          result: pending,
          evidence: command.photos.map((photoId) => ({
            id: photoId,
            path: `${id(99)}/${photoId}.jpg`,
            sha256: digest,
          })),
        },
        error: null,
      }
    if (name === 'complete_external_photo_analysis') {
      result = {
        ...pending,
        status: args.p_output ? 'ready' : 'failed',
        output: args.p_output,
      }
      return { data: null, error: null }
    }
    throw new Error(name)
  })
  const client = {
    rpc,
    storage: { from: () => ({ download }) },
  } as unknown as SupabaseClient
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      status: 'completed',
      usage: { input_tokens: 200, output_tokens: 30 },
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }],
        },
      ],
    }),
  )
  return { client, rpc, download, transport }
}
describe('central photo analysis', () => {
  it('uses all owned images in one explicit provider call and preserves usage', async () => {
    const f = fixture()
    const result = await runExternalPhotoAnalysis(
      f.client,
      command,
      AbortSignal.timeout(5000),
      env,
      f.transport,
    )
    expect(result.result?.output).toEqual(output)
    expect(f.download).toHaveBeenCalledTimes(2)
    expect(f.transport).toHaveBeenCalledTimes(1)
    expect(f.rpc).toHaveBeenCalledWith('complete_external_photo_analysis', {
      p_id: id(1),
      p_output: output,
      p_input: 200,
      p_output_tokens: 30,
    })
    const sent = JSON.parse(f.transport.mock.calls[0][1]!.body as string)
    expect(sent.store).toBe(false)
    expect(
      sent.input[0].content.filter(
        (x: { type: string }) => x.type === 'input_image',
      ),
    ).toHaveLength(2)
  })
  it.each(['pending', 'ready', 'failed'])(
    'reconciles %s without another provider call',
    async (status) => {
      const f = fixture({
        ...pending,
        status,
        output: status === 'ready' ? output : null,
      })
      await runExternalPhotoAnalysis(
        f.client,
        command,
        AbortSignal.timeout(5000),
        env,
        f.transport,
      )
      expect(f.transport).not.toHaveBeenCalled()
      expect(f.download).not.toHaveBeenCalled()
      expect(f.rpc).toHaveBeenCalledTimes(1)
    },
  )
  it('rejects a changed retry before accessing photos', async () => {
    const f = fixture(pending)
    await expect(
      runExternalPhotoAnalysis(
        f.client,
        { ...command, photos: [id(5)] },
        AbortSignal.timeout(5000),
        env,
        f.transport,
      ),
    ).rejects.toThrow('REQUEST_CONFLICT')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('retains provider failures as failed attempts, without fabricated proposals', async () => {
    const f = fixture()
    f.transport.mockRejectedValue(new Error('timeout'))
    expect(
      (
        await runExternalPhotoAnalysis(
          f.client,
          command,
          AbortSignal.timeout(5000),
          env,
          f.transport,
        )
      ).result?.status,
    ).toBe('failed')
    expect(f.rpc).toHaveBeenCalledWith(
      'complete_external_photo_analysis',
      expect.objectContaining({ p_output: null }),
    )
  })
  it('does not analyze changed storage bytes', async () => {
    const f = fixture()
    f.download.mockResolvedValue({ data: new Blob(['changed']), error: null })
    await runExternalPhotoAnalysis(
      f.client,
      command,
      AbortSignal.timeout(5000),
      env,
      f.transport,
    )
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('preserves usage when the model returns an invalid condition', async () => {
    const transport = vi.fn(async () =>
      Response.json({
        status: 'completed',
        usage: { input_tokens: 200, output_tokens: 30 },
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ ...output, condition: 'perfect' }),
              },
            ],
          },
        ],
      }),
    )
    const result = await generateExternalPhotoSuggestion(
      { key: 'synthetic', model: 'synthetic' },
      'sv',
      ['data:image/jpeg;base64,YQ=='],
      AbortSignal.timeout(5000),
      transport,
    )
    expect(result.output).toBeNull()
    expect(result.usage.input_tokens).toBe(200)
  })
})
