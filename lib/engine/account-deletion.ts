import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const deletionState = z.object({
  id: z.uuid(),
  status: z.enum(['requested', 'processing', 'completed']),
  createdAt: z.string().datetime({ offset: true }),
  respondBy: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  revision: z.uuid().nullable(),
})
export type DeletionState = z.infer<typeof deletionState>
export const deletionCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('state') }),
  z.strictObject({
    action: z.literal('request'),
    requestId: z.uuid(),
    locale: z.enum(['sv', 'en', 'no', 'da', 'fi', 'de', 'es', 'it']),
    confirmed: z.literal(true),
  }),
])
const evidence = z.strictObject({
  personalDataReviewed: z.literal(true),
  externalCopiesReviewed: z.literal(true),
  confirmationSent: z.literal(true),
  appleHandling: z.enum(['revoked', 'manual_instructions', 'not_applicable']),
  retentionReason: z.string().trim().min(10).max(2000),
  confirmationReference: z.string().trim().min(3).max(200),
})
export const handleDeletionCommand = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('processing'),
    eventId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid().nullable(),
    evidence: z.strictObject({}),
  }),
  z.strictObject({
    kind: z.literal('completed'),
    eventId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid(),
    evidence,
  }),
])
export const deletionChecks = z.object({
  authRemoved: z.boolean(),
  identitiesRemoved: z.boolean(),
  sessionsRemoved: z.boolean(),
  membershipsRemoved: z.boolean(),
  profileRemoved: z.boolean(),
  pushRemoved: z.boolean(),
  sellerContactsClosed: z.boolean(),
})
export const deletionCase = deletionState.extend({
  userId: z.uuid(),
  locale: z.string(),
  email: z.string(),
  phone: z.string(),
  appleLinked: z.boolean(),
  checks: deletionChecks,
  externalRequests: z.number().int().nonnegative(),
  externalPhotos: z.number().int().nonnegative(),
  stores: z.array(
    z.object({
      tenantId: z.uuid(),
      sellerId: z.uuid(),
      name: z.string(),
      closed: z.boolean(),
      balanceUnsettled: z.boolean(),
      openItems: z.number().int().nonnegative(),
    }),
  ),
})
export type DeletionCase = z.infer<typeof deletionCase>
const codes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'REQUEST_CHANGED',
  'REQUEST_NOT_FOUND',
  'DELETION_INCOMPLETE',
]
function fail(message: string): never {
  throw new Error(codes.includes(message) ? message : 'REQUEST_FAILED')
}
export async function executeDeletion(
  client: SupabaseClient,
  input: z.infer<typeof deletionCommand>,
) {
  const c = deletionCommand.parse(input)
  const result =
    c.action === 'state'
      ? await client.rpc('my_account_deletion')
      : await client.rpc('request_account_deletion', {
          p_id: c.requestId,
          p_locale: c.locale,
          p_confirm: c.confirmed,
        })
  if (result.error) fail(result.error.message)
  return {
    request: (c.action === 'state'
      ? deletionState.nullable()
      : deletionState
    ).parse(result.data),
  }
}
export async function readDeletionCases(
  client: SupabaseClient,
  offset: number,
) {
  const result = await client.rpc('host_account_deletions', {
    p_offset: z.number().int().min(0).max(100000).parse(offset),
  })
  if (result.error) fail(result.error.message)
  return z
    .object({
      rows: z.array(deletionCase),
      total: z.number().int().nonnegative(),
    })
    .parse(result.data)
}
export async function handleDeletion(
  client: SupabaseClient,
  input: z.infer<typeof handleDeletionCommand>,
) {
  const c = handleDeletionCommand.parse(input)
  const result = await client.rpc('handle_account_deletion', {
    p_id: c.eventId,
    p_request: c.requestId,
    p_expected: c.expected,
    p_kind: c.kind,
    p_evidence: c.evidence,
  })
  if (result.error) fail(result.error.message)
  return { request: deletionState.parse(result.data) }
}
