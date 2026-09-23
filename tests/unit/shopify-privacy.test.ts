import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parsePrivacyRequest as parseDelivery,
  readPrivacyBody,
  verifyPrivacyHmac,
} from '../../extensions/shopify/privacy'
import {
  receiveShopifyPrivacy,
  readShopifyPrivacy,
} from '../../lib/engine/shopify-privacy'
import { open } from '../../lib/platform/credentials'

const shop = 'synthetic.myshopify.com'
const deliveryId = '10000000-0000-4000-8000-000000000001'
const parsePrivacyRequest = (
  topic: Parameters<typeof parseDelivery>[0],
  raw: Uint8Array,
  domain: string,
) => parseDelivery(topic, raw, domain, deliveryId)
const env = { KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32) }
const body = {
  shop_id: 42,
  shop_domain: shop,
  customer: { id: 12, email: 'synthetic@example.test' },
  orders_requested: [99],
  data_request: { id: 7 },
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const secret = 'synthetic-secret'
describe('Shopify privacy receipt boundary', () => {
  it('does not discard a later uninstall with an identical payload', () => {
    const raw = bytes({ shop_id: 42, shop_domain: shop })
    const first = parseDelivery('shop/redact', raw, shop, deliveryId)
    const later = parseDelivery(
      'shop/redact',
      raw,
      shop,
      '10000000-0000-4000-8000-000000000002',
    )
    expect(later.fingerprint).not.toBe(first.fingerprint)
    expect(() => parseDelivery('shop/redact', raw, shop, null)).toThrow()
  })
  it('checks the raw bytes and canonical base64 using constant-time comparison', () => {
    const raw = bytes(body),
      signature = createHmac('sha256', secret).update(raw).digest('base64')
    expect(verifyPrivacyHmac(raw, signature, secret)).toBe(true)
    expect(
      verifyPrivacyHmac(
        Buffer.concat([raw, Buffer.from(' ')]),
        signature,
        secret,
      ),
    ).toBe(false)
    expect(verifyPrivacyHmac(raw, signature, 'different')).toBe(false)
    expect(verifyPrivacyHmac(raw, null, secret)).toBe(false)
    expect(verifyPrivacyHmac(raw, signature + '!', secret)).toBe(false)
    expect(verifyPrivacyHmac(raw, signature, '')).toBe(false)
  })
  it('minimizes data and uses a stable fingerprint across equivalent retries', () => {
    const first = parsePrivacyRequest(
      'customers/data_request',
      bytes(body),
      shop,
    )
    const second = parsePrivacyRequest(
      'customers/data_request',
      bytes({
        ...body,
        ignored: 'discard',
        customer: { ...body.customer, extra: 'discard' },
      }),
      shop,
    )
    expect(second).toEqual(first)
    expect(JSON.stringify(first.payload)).not.toContain('discard')
  })
  it('refuses mismatched domains, lossy numeric IDs and topic confusion', () => {
    expect(() =>
      parsePrivacyRequest(
        'customers/data_request',
        bytes(body),
        'other.myshopify.com',
      ),
    ).toThrow()
    expect(() =>
      parsePrivacyRequest(
        'customers/data_request',
        bytes({ ...body, shop_id: Number.MAX_SAFE_INTEGER + 1 }),
        shop,
      ),
    ).toThrow()
    expect(() =>
      parsePrivacyRequest('shop/redact', bytes(body), shop),
    ).toThrow()
    expect(() =>
      parsePrivacyRequest('customers/redact', bytes(body), shop),
    ).toThrow()
  })
  it('supports all required topics and email-only customer requests', () => {
    expect(
      parsePrivacyRequest(
        'shop/redact',
        bytes({ shop_id: '42', shop_domain: shop }),
        shop,
      ).topic,
    ).toBe('shop/redact')
    expect(
      parsePrivacyRequest(
        'customers/redact',
        bytes({
          shop_id: 42,
          shop_domain: shop,
          customer: { email: 'synthetic@example.test' },
          orders_to_redact: [99],
        }),
        shop,
      ).topic,
    ).toBe('customers/redact')
  })
  it('enforces streamed byte limits without relying on Content-Length', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: 'ååå',
    })
    await expect(readPrivacyBody(request, 5)).rejects.toThrow('BODY_TOO_LARGE')
    expect(
      (
        await readPrivacyBody(
          new Request('https://example.test', { method: 'POST', body: '{}' }),
          2,
        )
      ).toString(),
    ).toBe('{}')
  })
  it('encrypts before the RPC and never accepts a tenant from the webhook', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const receipt = parsePrivacyRequest(
      'customers/data_request',
      bytes(body),
      shop,
    )
    await receiveShopifyPrivacy(
      { rpc } as unknown as SupabaseClient,
      receipt,
      env,
    )
    const args = rpc.mock.calls[0][1]
    expect(args.p_tenant).toBeUndefined()
    expect(JSON.stringify(args)).not.toContain('synthetic@example.test')
    expect(open('shopify-privacy', args.p_cipher, env)).toEqual(receipt.payload)
  })
  it('does not acknowledge a failed durable write', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { message: 'sensitive provider error' } })
    await expect(
      receiveShopifyPrivacy(
        { rpc } as unknown as SupabaseClient,
        parsePrivacyRequest('customers/data_request', bytes(body), shop),
        env,
      ),
    ).rejects.toThrow('SHOPIFY_PRIVACY_RECEIPT_FAILED')
  })
  it('refuses to expose payloads if SQL denies the user', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '42501' } })
    await expect(
      readShopifyPrivacy(
        { rpc } as unknown as SupabaseClient,
        '10000000-0000-4000-8000-000000000001',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
})
