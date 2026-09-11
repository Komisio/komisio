import { describe, it, expect } from 'vitest'
import { can, canChangeMember } from '../../lib/platform/permissions'
import {
  safeNext,
  commandSchema,
  errorCode,
} from '../../lib/platform/validation'
import sv from '../../messages/sv.json'
import en from '../../messages/en.json'
import { resolveLocale } from '../../lib/i18n'

describe('language preference', () => {
  it('retains an explicit browser choice over a default or different profile', () => {
    expect(resolveLocale('en', 'sv')).toBe('en')
    expect(resolveLocale('sv', 'en')).toBe('sv')
    expect(resolveLocale('en')).toBe('en')
  })
  it('uses the saved profile or Swedish when no supported browser choice exists', () => {
    expect(resolveLocale(undefined, 'en')).toBe('en')
    expect(resolveLocale('unsupported', 'en')).toBe('en')
    expect(resolveLocale('unsupported', 'unsupported')).toBe('sv')
  })
})
describe('permission boundaries', () => {
  it('never treats read access as administration', () => {
    expect(can('readonly', 'members.manage')).toBe(false)
    expect(can('staff', 'tenant.edit')).toBe(false)
    expect(can(null, 'audit.read')).toBe(false)
  })
  it('limits delegated administrators to staff and readonly', () => {
    expect(canChangeMember('admin', 'staff', 'readonly')).toBe(true)
    expect(canChangeMember('admin', 'staff', 'owner')).toBe(false)
    expect(canChangeMember('admin', 'owner', null)).toBe(false)
    expect(canChangeMember('admin', 'admin', 'staff')).toBe(false)
  })
  it('allows owners to manage ownership through the guarded operation', () =>
    expect(canChangeMember('owner', 'staff', 'owner')).toBe(true))
})
describe('untrusted input', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/api/platform',
    '/invite/anything',
    'javascript:alert(1)',
  ])('rejects unsafe callback destination %s', (value) =>
    expect(safeNext(value)).toBe('/'),
  )
  it('preserves only valid invitation destinations', () =>
    expect(safeNext('/invite/' + 'a'.repeat(64))).toBe(
      '/invite/' + 'a'.repeat(64),
    ))
  it('does not accept owner invitations', () =>
    expect(
      commandSchema.safeParse({
        action: 'invite',
        tenantId: crypto.randomUUID(),
        email: 'user@example.test',
        role: 'owner',
      }).success,
    ).toBe(false))
  it('requires a request id for idempotent creation', () =>
    expect(
      commandSchema.safeParse({
        action: 'create',
        name: 'Store',
        slug: 'store',
      }).success,
    ).toBe(false))
  it('maps the owner guard without exposing a database exception', () =>
    expect(errorCode('komisio: cannot remove the last owner')).toBe(
      'LAST_OWNER',
    ))
})
it('keeps both UI languages complete', () => {
  expect(Object.keys(sv).sort()).toEqual(Object.keys(en).sort())
  expect(Object.keys(sv.errors).sort()).toEqual(Object.keys(en.errors).sort())
  expect(Object.keys(sv.roles).sort()).toEqual(Object.keys(en.roles).sort())
})
