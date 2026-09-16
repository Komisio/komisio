import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, intlLocale, resolveLocale } from '../i18n'
import { sendSellerEmailWithId } from '../platform/seller-email'

// Trial and grace notices to store owners (ONBOARDING-AND-PLANS.md, slice
// 2). The database says what is due and records what was sent, once per
// store and kind; the text is a fixed template in the owner's language; the
// transport is the allowlisted pilot e-mail.
export const noticeKinds = [
  'trial_week',
  'trial_tomorrow',
  'trial_ended',
  'grace_week',
] as const
export type NoticeKind = (typeof noticeKinds)[number]
const dueRow = z.object({
  tenant_id: z.uuid(),
  store_name: z.string(),
  kind: z.enum(noticeKinds),
  deadline: z.string().nullable(),
  locale: z.string(),
  emails: z.array(z.string()),
})
export type DueNotice = z.infer<typeof dueRow>

export async function readDueNotices(client: SupabaseClient) {
  const r = await client.rpc('due_plan_notices')
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(dueRow).parse(r.data)
}

/** Pure: subject and text for one notice, fixed wording, no HTML. */
export function renderNotice(notice: DueNotice, origin: string) {
  const locale = resolveLocale(undefined, notice.locale)
  const t = dictionary(locale).planNotices
  const date = notice.deadline
    ? new Date(notice.deadline).toLocaleDateString(intlLocale(locale), {
        timeZone: 'Europe/Stockholm',
      })
    : ''
  const fill = (s: string) =>
    s
      .replace('{store}', notice.store_name)
      .replace('{date}', date)
      .replace('{link}', `${origin}/settings`)
  const body = t[notice.kind]
  return {
    subject: fill(body.subject),
    text: `${fill(body.text)}\n\n${fill(t.footer)}`,
  }
}

/**
 * Sends every due notice to the store's owners and records the outcome.
 * One record per store and kind; a store with no owner address is recorded
 * as `none` so it is not retried every day.
 */
export async function sendDueNotices(
  client: SupabaseClient,
  origin: string,
  env: Record<string, string | undefined> = process.env,
  transport = sendSellerEmailWithId,
) {
  const due = await readDueNotices(client)
  const results: { tenantId: string; kind: NoticeKind; delivery: string }[] = []
  for (const notice of due) {
    const { subject, text } = renderNotice(notice, origin)
    let delivery = 'none'
    if (notice.emails.length > 0) {
      const outcomes = await Promise.all(
        notice.emails.map((to) =>
          transport(
            {
              communicationId: `plan-notice/${notice.tenant_id}/${notice.kind}/${to}`,
              to,
              subject,
              text,
            },
            env,
          ),
        ),
      )
      const statuses = outcomes.map((o) => o.status)
      delivery = statuses.includes('sent')
        ? 'sent'
        : statuses.includes('unconfirmed')
          ? 'unconfirmed'
          : statuses.includes('failed')
            ? 'failed'
            : statuses.includes('restricted')
              ? 'restricted'
              : 'manual'
    }
    const r = await client.rpc('record_plan_notice', {
      p_tenant: notice.tenant_id,
      p_kind: notice.kind,
      p_recipients: notice.emails.length,
      p_delivery: delivery,
    })
    if (r.error) throw new Error(r.error.message)
    results.push({ tenantId: notice.tenant_id, kind: notice.kind, delivery })
  }
  return results
}
