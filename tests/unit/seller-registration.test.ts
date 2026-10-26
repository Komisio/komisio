import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  registrationCommand,
  registrationTokenFromNext,
  readPublicRegistrationStore,
} from '../../lib/engine/seller-registration'
import { safeNext } from '../../lib/platform/validation'

describe('seller registration boundary', () => {
  const valid = {
    action: 'apply',
    token: 'a'.repeat(64),
    requestId: 'd3520000-0000-4000-8000-000000000001',
    name: 'Synthetic seller',
    phone: '+46700000000',
    agreementId: 'd3520000-0000-4000-8000-000000000002',
    translationId: null,
    accepted: true,
  }
  it('takes identity only from the verified session', () => {
    expect(registrationCommand.safeParse(valid).success).toBe(true)
    for (const extra of [
      { email: 'other@example.test' },
      { userId: valid.requestId },
      { tenantId: valid.requestId },
      { approved: true },
    ])
      expect(
        registrationCommand.safeParse({ ...valid, ...extra }).success,
      ).toBe(false)
  })
  it('requires explicit acceptance, bounded contacts and valid version references', () => {
    for (const patch of [
      { accepted: false },
      { name: ' ' },
      { phone: '' },
      { phone: 'x'.repeat(41) },
      { agreementId: null },
      { token: 'x' },
    ])
      expect(
        registrationCommand.safeParse({ ...valid, ...patch }).success,
      ).toBe(false)
  })
  it('preserves only exact same-application registration destinations through authentication', () => {
    const destination = '/join/' + 'a'.repeat(64)
    expect(safeNext(destination)).toBe(destination)
    for (const value of [
      destination + '?next=https://evil.test',
      destination + '/anything',
      destination + '#x',
      '//evil.test' + destination,
      '/join/%2f%2fevil.test',
      '/join/' + 'A'.repeat(64),
    ])
      expect(safeNext(value)).toBe('/')
  })
  it('resolves only exact registration destinations, never URL-supplied names or external paths', () => {
    const token = 'a'.repeat(64)
    expect(registrationTokenFromNext(`/join/${token}`)).toBe(token)
    for (const value of [
      undefined,
      ['/join/' + token],
      '/join/' + token + '?store=Fake',
      '/join/' + token + '#x',
      'https://evil.test/join/' + token,
      '/join/' + token.toUpperCase(),
    ])
      expect(registrationTokenFromNext(value)).toBeNull()
  })
  it('reads only the name projection and does not turn unexpected errors into invalid-link claims', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: 'Store <b>$&</b>', error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readPublicRegistrationStore(client, 'a'.repeat(64))).toBe(
      'Store <b>$&</b>',
    )
    expect(rpc).toHaveBeenCalledWith('public_seller_registration_store', {
      p_token: 'a'.repeat(64),
    })
    expect(await readPublicRegistrationStore(client, 'bad')).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await readPublicRegistrationStore(client, 'a'.repeat(64))).toBeNull()
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'private details' },
    })
    await expect(
      readPublicRegistrationStore(client, 'a'.repeat(64)),
    ).rejects.toThrow('REQUEST_FAILED')
  })
})
