import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n'

export const registrationToken = z.string().regex(/^[a-f0-9]{64}$/)
export const registrationCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('mailSettings'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid().nullable(),
    enabled: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('settings'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid().nullable(),
    change: z.enum(['enable', 'disable', 'rotate']),
  }),
  z.strictObject({
    action: z.literal('apply'),
    token: registrationToken,
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(1).max(40),
    agreementId: z.uuid(),
    translationId: z.uuid().nullable(),
    accepted: z.literal(true),
    mailSettingId: z.uuid().nullable().default(null),
  }),
  z.strictObject({
    action: z.literal('review'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    registrationId: z.uuid(),
    approved: z.boolean(),
  }),
])
export type RegistrationCommand = z.infer<typeof registrationCommand>
const agreementText = z.object({
  version: z.number().int(),
  title: z.string(),
  body: z.string(),
  language: z.string(),
})
const agreement = agreementText.extend({
  id: z.uuid(),
  translationId: z.uuid().nullable(),
})
export const registrationSettings = z.object({
  id: z.uuid().nullable(),
  enabled: z.boolean(),
  token: registrationToken.nullable(),
  hasAgreement: z.boolean(),
})
export type RegistrationSettings = z.infer<typeof registrationSettings>
export const registrationEntry = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable') }),
  z.object({
    state: z.literal('existing'),
    tenantId: z.uuid(),
    storeName: z.string(),
    email: z.string(),
    sellerId: z.uuid(),
  }),
  z.object({
    state: z.literal('pending'),
    tenantId: z.uuid(),
    storeName: z.string(),
    email: z.string(),
  }),
  z.object({
    state: z.literal('form'),
    mailSettingId: z.uuid().nullable().default(null),
    tenantId: z.uuid(),
    storeName: z.string(),
    email: z.string(),
    agreement,
  }),
])
export type RegistrationEntry = z.infer<typeof registrationEntry>
const myRegistrations = z.array(
  z.object({
    id: z.uuid(),
    storeName: z.string(),
    createdAt: z.string(),
    state: z.enum(['pending', 'approved', 'rejected']),
  }),
)
export const storeRegistrations = z.object({
  total: z.number().int(),
  rows: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      createdAt: z.string(),
      agreement: agreementText,
      matches: z.number().int(),
      emailChanged: z.boolean(),
    }),
  ),
})
export type StoreRegistration = z.infer<
  typeof storeRegistrations
>['rows'][number]
export async function readRegistrationSettings(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('seller_registration_settings', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return registrationSettings.parse(r.data)
}
export async function readRegistrationEntry(
  client: SupabaseClient,
  token: string,
  locale: Locale,
) {
  const r = await client.rpc('seller_registration_entry', {
    p_token: registrationToken.parse(token),
    p_language: locale,
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return registrationEntry.parse(r.data)
}
export async function readMyRegistrations(client: SupabaseClient) {
  const r = await client.rpc('my_seller_registrations')
  if (r.error) throw new Error('REQUEST_FAILED')
  return myRegistrations.parse(r.data)
}
export async function readStoreRegistrations(
  client: SupabaseClient,
  tenantId: string,
  offset: number,
) {
  const r = await client.rpc('store_seller_registrations', {
    p_tenant: z.uuid().parse(tenantId),
    p_offset: z.number().int().min(0).max(1000000).parse(offset),
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return storeRegistrations.parse(r.data)
}
export async function executeRegistration(
  client: SupabaseClient,
  input: RegistrationCommand,
) {
  const c = registrationCommand.parse(input)
  if (c.action === 'mailSettings')
    return client.rpc('set_store_mail_auto', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_expected: c.expected,
      p_enabled: c.enabled,
    })
  if (c.action === 'settings')
    return client.rpc('set_seller_registration', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_expected: c.expected,
      p_action: c.change,
    })
  if (c.action === 'apply')
    return client.rpc('submit_seller_registration', {
      p_token: c.token,
      p_id: c.requestId,
      p_name: c.name,
      p_phone: c.phone,
      p_agreement: c.agreementId,
      p_translation: c.translationId,
      p_accepted: c.accepted,
      p_mail_setting: c.mailSettingId,
    })
  return client.rpc('review_seller_registration', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_registration: c.registrationId,
    p_approved: c.approved,
  })
}
