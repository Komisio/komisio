import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  guestPhotoCommand,
  runGuestPhotoAnalysis,
} from '../../lib/engine/guest-photo-assistance'
import { guestPhotoNetworkHash } from '../../lib/platform/guest-photo-client'

const id = (n: number) =>
  `f9810000-0000-4000-8000-${String(n).padStart(12, '0')}`
const env = {
  KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
  KOMISIO_RECEPTION_AI_KEY: 'synthetic',
  KOMISIO_RECEPTION_AI_MODEL: 'synthetic',
  KOMISIO_SELLER_AI_SERVER_KEY: 'a'.repeat(64),
}
const output = {
  description: 'Dress',
  brand: null,
  condition: 'good',
  notes: '',
  estimatedWeightG: 350,
}
const command = async () => ({
  action: 'analyze' as const,
  requestId: id(1),
  token: 'b'.repeat(64),
  tenantId: id(2),
  language: 'sv',
  startedAt: '2026-11-18T21:00:00.000Z',
  photos: [
    {
      id: id(3),
      data: (
        await sharp({
          create: { width: 10, height: 10, channels: 3, background: '#fff' },
        })
          .jpeg()
          .withMetadata()
          .toBuffer()
      ).toString('base64'),
    },
  ],
})
function fixture(reserved = true) {
  let result: {
    id: string
    tenantId: string
    photos: string[]
    language: string
    status: string
    output: Omit<typeof output, 'estimatedWeightG'> | null
  } = {
    id: id(1),
    tenantId: id(2),
    photos: [id(3)],
    language: 'sv',
    status: 'pending',
    output: null,
  }
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'guest_photo_ai_configuration')
      return { data: { own: null }, error: null }
    if (name === 'read_guest_photo_analysis')
      return { data: result, error: null }
    if (name === 'begin_guest_photo_analysis')
      return { data: { reserved, result }, error: null }
    if (name === 'complete_guest_photo_analysis') {
      const o = args?.p_output as typeof output | null
      result = {
        ...result,
        status: o ? 'ready' : 'failed',
        output: o
          ? {
              description: o.description,
              brand: o.brand,
              condition: o.condition,
              notes: o.notes,
            }
          : null,
      }
      return { data: null, error: null }
    }
    throw new Error(name)
  })
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 10 },
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }],
        },
      ],
    }),
  )
  return { client: { rpc } as unknown as SupabaseClient, rpc, transport }
}
describe('guest photo AI', () => {
  it('uses transient sanitized bytes, hashes the capability and persists trusted evidence without an Auth or Storage client', async () => {
    const f = fixture(),
      c = await command()
    const result = await runGuestPhotoAnalysis(
      f.client,
      c,
      'c'.repeat(64),
      AbortSignal.timeout(5000),
      env,
      f.transport,
    )
    expect(result.result?.output?.description).toBe('Dress')
    expect(result.result?.output).not.toHaveProperty('estimatedWeightG')
    const body = JSON.parse(f.transport.mock.calls[0][1]!.body as string)
    expect(body.store).toBe(false)
    const bytes = Buffer.from(
      body.input[0].content[1].image_url.split(',')[1],
      'base64',
    )
    expect((await sharp(bytes).metadata()).exif).toBeUndefined()
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(f.rpc).toHaveBeenCalledWith(
      'complete_guest_photo_analysis',
      expect.objectContaining({
        p_output: output,
        p_evidence: [digest],
        p_token_hash: createHash('sha256').update(c.token).digest('hex'),
      }),
    )
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(c.token)
    expect(f.transport).toHaveBeenCalledTimes(1)
  })
  it('does not run a model again for an already reserved analysis', async () => {
    const f = fixture(false)
    expect(
      (
        await runGuestPhotoAnalysis(
          f.client,
          await command(),
          'c'.repeat(64),
          AbortSignal.timeout(5000),
          env,
          f.transport,
        )
      ).result?.status,
    ).toBe('pending')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('records invalid image failures after reservation, without a model request', async () => {
    const f = fixture(),
      c = await command()
    c.photos[0].data = Buffer.from('not-an-image').toString('base64')
    expect(
      (
        await runGuestPhotoAnalysis(
          f.client,
          c,
          'c'.repeat(64),
          AbortSignal.timeout(5000),
          env,
          f.transport,
        )
      ).result?.status,
    ).toBe('failed')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('does not let read callers supply results, model names or another owner', async () => {
    for (const extra of [
      { output },
      { ownerId: id(4) },
      { model: 'expensive' },
      { tenantId: id(2) },
    ])
      expect(
        guestPhotoCommand.safeParse({
          action: 'read',
          requestId: id(1),
          token: 'b'.repeat(64),
          ...extra,
        }).success,
      ).toBe(false)
    const f = fixture()
    await runGuestPhotoAnalysis(
      f.client,
      { action: 'read', requestId: id(1), token: 'b'.repeat(64) },
      'c'.repeat(64),
      AbortSignal.timeout(5000),
      {},
      f.transport,
    )
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
      'read_guest_photo_analysis',
    ])
  })
  it('does not trust forwarded addresses outside Vercel and never stores the raw IP', () => {
    const request = (ip: string) =>
      new Request('https://app.example.test', {
        headers: { 'x-vercel-forwarded-for': ip, 'x-forwarded-for': ip },
      })
    expect(guestPhotoNetworkHash(request('192.0.2.1'), env)).toBe(
      guestPhotoNetworkHash(request('192.0.2.2'), env),
    )
    const hosted = { ...env, VERCEL: '1' }
    expect(guestPhotoNetworkHash(request('192.0.2.1'), hosted)).not.toBe(
      guestPhotoNetworkHash(request('192.0.2.2'), hosted),
    )
    expect(guestPhotoNetworkHash(request('192.0.2.1'), hosted)).toMatch(
      /^[a-f0-9]{64}$/,
    )
  })
})
