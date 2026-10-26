import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { locales, type Locale } from '../i18n'
import { emailTemplate } from './locale'
import { plainText } from './templates'
import { sendSellerEmailWithId } from '../platform/seller-email'

const noticeFacts = z.strictObject({
  tenantId: z.uuid(),
  reviewId: z.uuid(),
  sellerId: z.uuid(),
  recipient: z.string().min(3).max(254),
  locale: z.enum(locales),
  storeName: z.string().min(1).max(120),
  sellerName: z.string().min(1).max(120),
})

export function renderRegistrationApproval(
  requested: Locale,
  storeName: string,
  sellerName: string,
  appUrl: string,
) {
  const { locale, copy } = emailTemplate(
    requested,
    (d) => d.registrationApprovalEmail,
  )
  const base = new URL(appUrl)
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('INVALID_INPUT')
  const link = new URL('/login', base.origin)
  link.searchParams.set('next', '/seller')
  link.searchParams.set('locale', locale)
  const values: Record<string, string> = {
    store: plainText(storeName).replace(/\n/g, ' '),
    seller: plainText(sellerName).replace(/\n/g, ' '),
    url: link.href,
  }
  const fill = (text: string) =>
    text.replace(/\{(store|seller|url)\}/g, (_, key: string) => values[key])
  return {
    locale,
    subject: fill(copy.subject).slice(0, 200),
    body: fill(copy.body),
  }
}

/** The committed claim grants one transport attempt. A lost claim response or
 * delivery result never becomes permission to send again, even with a new ID. */
export async function notifyRegistrationApproval(
  client: SupabaseClient,
  tenantId: string,
  reviewId: string,
  env: Record<string, string | undefined> = process.env,
  send = sendSellerEmailWithId,
) {
  const read = await client.rpc('registration_approval_notice', {
    p_tenant: z.uuid().parse(tenantId),
    p_review: z.uuid().parse(reviewId),
  })
  if (read.error) throw new Error('REGISTRATION_NOTICE_READ_FAILED')
  if (read.data === null) return { attempted: false }
  const facts = noticeFacts.parse(read.data)
  if (facts.tenantId !== tenantId || facts.reviewId !== reviewId)
    throw new Error('REGISTRATION_NOTICE_FACT_MISMATCH')
  const rendered = renderRegistrationApproval(
    facts.locale,
    facts.storeName,
    facts.sellerName,
    env.NEXT_PUBLIC_APP_URL ?? '',
  )
  const id = randomUUID()
  const claim = await client.rpc('claim_registration_approval_notice', {
    p_id: id,
    p_facts: facts,
    p_locale: rendered.locale,
    p_subject: rendered.subject,
    p_body: rendered.body,
  })
  if (claim.error) throw new Error('REGISTRATION_NOTICE_CLAIM_FAILED')
  if (claim.data === null) return { attempted: false }
  if (claim.data !== id) throw new Error('REGISTRATION_NOTICE_CLAIM_MISMATCH')
  let outcome: Awaited<ReturnType<typeof sendSellerEmailWithId>>
  try {
    outcome = await send(
      {
        communicationId: id,
        to: facts.recipient,
        subject: rendered.subject,
        text: rendered.body,
      },
      env,
    )
  } catch {
    outcome = { status: 'unconfirmed', providerMessageId: '' }
  }
  const result = await client.rpc('record_communication_delivery', {
    p_tenant: tenantId,
    p_id: id,
    p_status: outcome.status,
    p_provider_message_id: outcome.providerMessageId,
  })
  if (result.error || result.data !== id)
    throw new Error('REGISTRATION_NOTICE_FINISH_FAILED')
  return { attempted: true, delivery: outcome.status }
}
