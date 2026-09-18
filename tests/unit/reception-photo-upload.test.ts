import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadReceptionPhoto } from '../../lib/engine/reception-photos'

vi.mock('../../lib/engine/reception-store', () => ({
  readReceptionSession: vi.fn(async () => ({ status: 'ready' })),
}))
afterEach(() => vi.restoreAllMocks())
const input = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  photoId: '10000000-0000-4000-8000-000000000003',
}

it.each(['original_storage', 'derivative_storage', 'digest'])(
  'identifies %s failure without disclosing provider details',
  async (stage) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
    const privateError = {
      message: 'private provider data',
      code: 'private-code',
    }
    const client = {
      rpc: vi.fn(async (name: string) =>
        name === 'tenant_role'
          ? { data: 'staff', error: null }
          : { error: stage === 'digest' ? privateError : null },
      ),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async () => ({
            error:
              (stage === 'original_storage' && bucket === 'reception-photos') ||
              (stage === 'derivative_storage' &&
                bucket === 'seller-reception-photos')
                ? privateError
                : null,
          })),
          download: vi.fn(async () => ({ error: privateError })),
        })),
      },
    } as unknown as SupabaseClient
    await expect(uploadReceptionPhoto(client, input, bytes)).rejects.toThrow(
      'PHOTO_UPLOAD_FAILED',
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Reception photo: upload failed',
      { stage },
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.tenantId)
  },
)

it('rejects an unsupported file before accessing storage', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(
    uploadReceptionPhoto(
      {} as SupabaseClient,
      input,
      Buffer.from('not an image'),
    ),
  ).rejects.toThrow('INVALID_IMAGE')
  expect(log).toHaveBeenCalledExactlyOnceWith(
    'Reception photo: upload failed',
    { stage: 'input' },
  )
})
