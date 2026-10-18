import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'

const tenantId = z.uuid()
export const storeMailCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('preview'), tenantId }),
  z.strictObject({
    action: z.literal('create'),
    tenantId,
    requestId: z.uuid(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s)),
    body: z.string().trim().min(1).max(7000),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({ action: z.literal('process'), tenantId, sendId: z.uuid() }),
  z.strictObject({
    action: z.literal('consent'),
    tenantId,
    sellerId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid().nullable(),
    enabled: z.boolean(),
  }),
])
export const unsubscribeCommand = z.strictObject({
  messageId: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
})
export const consentState = z.object({
  id: z.uuid().nullable(),
  enabled: z.boolean(),
})
export type ConsentState = z.infer<typeof consentState>
export const mailPreview = z.object({
  eligible: z.number().int(),
  missingEmail: z.number().int(),
  withoutConsent: z.number().int(),
  revision: z.string(),
  replyTo: z.string(),
  senderName: z.string(),
})
export type MailPreview = z.infer<typeof mailPreview>
export const mailHistory = z.array(
  z.object({
    id: z.uuid(),
    subject: z.string(),
    body: z.string(),
    senderName: z.string(),
    replyTo: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    total: z.number().int(),
    missingEmail: z.number().int(),
    withoutConsent: z.number().int(),
    skipped: z.number().int(),
    remaining: z.number().int(),
    outcomes: z.record(z.string(), z.number().int()),
  }),
)
export type MailHistory = z.infer<typeof mailHistory>
export const mailClaim = z.union([
  z.object({ done: z.literal(true) }),
  z.object({ waitMs: z.number().nonnegative() }),
  z.object({
    messageId: z.uuid(),
    to: z.email(),
    subject: z.string(),
    body: z.string(),
    senderName: z.string(),
    replyTo: z.email(),
    locale: z.enum(locales),
  }),
])
export async function readMailHistory(client: SupabaseClient, tenant: string) {
  const r = await client.rpc('store_mail_history', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return mailHistory.parse(r.data)
}
export async function readMailConsent(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const r = await client.rpc('my_store_mail_consent', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return consentState.parse(r.data)
}
export async function executeStoreMail(
  client: SupabaseClient,
  input: z.infer<typeof storeMailCommand>,
) {
  const c = storeMailCommand.parse(input)
  if (c.action === 'preview')
    return client.rpc('preview_store_mail', { p_tenant: c.tenantId })
  if (c.action === 'create')
    return client.rpc('create_store_mail', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_subject: c.subject,
      p_body: c.body,
      p_revision: c.revision,
    })
  if (c.action === 'consent')
    return client.rpc('set_store_mail_consent', {
      p_tenant: c.tenantId,
      p_seller: c.sellerId,
      p_id: c.requestId,
      p_expected: c.expected,
      p_enabled: c.enabled,
    })
  throw new Error('INVALID_INPUT')
}
