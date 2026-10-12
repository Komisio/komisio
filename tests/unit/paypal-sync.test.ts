import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('../../lib/engine/zettle-stock', () => ({ exportZettleItem: vi.fn() }))
vi.mock('../../lib/engine/zettle-images', () => ({
  exportZettleImage: vi.fn(),
}))
vi.mock('../../lib/engine/sync-preferences', () => ({
  readSyncPreferences: vi.fn(),
}))
vi.mock('../../lib/engine/paypal-status', () => ({
  readPayPalItemStatus: vi.fn(),
}))
import { exportZettleItem } from '../../lib/engine/zettle-stock'
import { exportZettleImage } from '../../lib/engine/zettle-images'
import { readSyncPreferences } from '../../lib/engine/sync-preferences'
import { readPayPalItemStatus } from '../../lib/engine/paypal-status'
import { syncPayPalItem } from '../../lib/engine/paypal-sync'
const tenant = '10000000-0000-4000-8000-000000000001',
  request = '20000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001'
const client = {} as SupabaseClient
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readPayPalItemStatus).mockResolvedValue([])
  vi.mocked(exportZettleImage).mockResolvedValue({
    id: request,
    image: 'synced',
  })
})
it('does not start image work when this connection is disabled, regardless of another system', async () => {
  vi.mocked(readSyncPreferences).mockResolvedValue([
    {
      provider: 'paypal',
      connectionId: 'paypal',
      revision: null,
      images: false,
    },
    {
      provider: 'shopify',
      connectionId: 'shopify',
      revision: null,
      images: true,
    },
  ])
  await syncPayPalItem(client, tenant, request, item, {})
  expect(exportZettleItem).toHaveBeenCalledTimes(1)
  expect(exportZettleImage).not.toHaveBeenCalled()
})
it('sends the image only after product export and requires a fresh settings check', async () => {
  vi.mocked(readSyncPreferences).mockResolvedValue([
    {
      provider: 'paypal',
      connectionId: 'paypal',
      revision: null,
      images: true,
    },
  ])
  await syncPayPalItem(client, tenant, request, item, {})
  expect(vi.mocked(exportZettleItem).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(exportZettleImage).mock.invocationCallOrder[0],
  )
  expect(exportZettleImage).toHaveBeenCalledWith(
    client,
    tenant,
    request,
    item,
    {},
    undefined,
    true,
  )
})
it('reconciles an uploaded image before product retry after a lost association acknowledgement', async () => {
  vi.mocked(readSyncPreferences).mockResolvedValue([
    {
      provider: 'paypal',
      connectionId: 'paypal',
      revision: null,
      images: true,
    },
  ])
  vi.mocked(readPayPalItemStatus).mockResolvedValue([
    {
      itemId: item,
      status: 'synced',
      productStatus: 'synced',
      productAt: null,
      stockStatus: 'initialized',
      stockAt: null,
      imageStatus: 'uploaded',
      errorCode: null,
      canExport: true,
      connected: true,
    },
  ])
  await syncPayPalItem(client, tenant, request, item, {})
  expect(vi.mocked(exportZettleImage).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(exportZettleItem).mock.invocationCallOrder[0],
  )
})
