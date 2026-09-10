import { z } from 'zod'
import { roles } from './permissions'
const tenantId = z.uuid()
export const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1).max(100),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    requestId: z.uuid(),
  }),
  z.object({ action: z.literal('select'), tenantId }),
  z.object({
    action: z.literal('profile'),
    name: z.string().trim().max(100),
    locale: z.enum(['sv', 'en']),
  }),
  z.object({
    action: z.literal('rename'),
    tenantId,
    name: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal('invite'),
    tenantId,
    email: z.email().max(254),
    role: z.enum(['admin', 'staff', 'readonly']),
  }),
  z.object({ action: z.literal('revoke'), tenantId, invitationId: z.uuid() }),
  z.object({
    action: z.literal('member'),
    tenantId,
    userId: z.uuid(),
    role: z.enum(roles).nullable(),
  }),
  z.object({
    action: z.literal('accept'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }),
])
export function safeNext(value: string | null | undefined) {
  if (value === '/account') return value
  if (value && /^\/invite\/[a-f0-9]{64}$/.test(value)) return value
  return '/'
}
export function errorCode(message: string, code?: string) {
  if (message.includes('last owner')) return 'LAST_OWNER'
  for (const value of [
    'FORBIDDEN',
    'AUTH_REQUIRED',
    'INVITATION_INVALID',
    'ALREADY_MEMBER',
    'INVALID_INPUT',
    'MEMBER_NOT_FOUND',
  ]) {
    if (message.includes(value)) return value
  }
  if (code === '23505') return 'SLUG_TAKEN'
  return 'REQUEST_FAILED'
}
