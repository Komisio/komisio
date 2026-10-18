import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mailClaim, readMailHistory } from '../engine/store-mail'
import { sendStoreEmail } from '../platform/store-email'
import { dictionary } from '../i18n'

/** One bounded step. Only a newly committed claim can reach the provider. */
export async function processStoreMail(
  client: SupabaseClient,
  tenantId: string,
  sendId: string,
  appUrl: string,
) {
  const token = randomBytes(32).toString('hex')
  const claim = await client.rpc('claim_store_mail', {
    p_tenant: tenantId,
    p_send: sendId,
    p_message: randomUUID(),
    p_unsubscribe_hash: createHash('sha256').update(token).digest('hex'),
  })
  if (claim.error) throw new Error(claim.error.message)
  const c = mailClaim.parse(claim.data)
  if ('waitMs' in c) return { waitMs: c.waitMs }
  if ('done' in c)
    return { done: true, history: await readMailHistory(client, tenantId) }
  const url = new URL('/unsubscribe', appUrl)
  url.searchParams.set('lang', c.locale)
  url.hash = `${c.messageId}.${token}`
  const footer = dictionary(c.locale).storeMail.footer
  const delivery = await sendStoreEmail({
    ...c,
    text: `${c.body}\n\n${c.senderName}\n${footer}\n${url.href}`,
  })
  if (delivery.cooldown) {
    const deferred = await client.rpc('defer_store_mail', {
      p_tenant: tenantId,
      p_send: sendId,
      p_seconds: delivery.cooldown,
    })
    if (deferred.error) throw new Error('REQUEST_FAILED')
  }
  const recorded = await client.rpc('record_communication_delivery', {
    p_tenant: tenantId,
    p_id: c.messageId,
    p_status: delivery.status,
    p_provider_message_id: delivery.providerMessageId,
  })
  if (recorded.error) throw new Error('REQUEST_FAILED')
  return {
    done: false,
    stop: delivery.status !== 'sent',
    history: await readMailHistory(client, tenantId),
    waitMs: Math.max(1000, delivery.cooldown * 1000),
  }
}
