import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, resolveLocale } from '../i18n'
import { readEconomyBrief, renderBrief } from './brief'
import { sendSellerEmailWithId } from '../platform/seller-email'

// Weekly brief by e-mail (ONBOARDING-AND-PLANS.md, "Delivered" section):
// every Monday the automation identity mails last week's brief to the
// owners of the stores that switched it on, once per store and week.
const dueRow = z.object({
  tenant_id: z.uuid(),
  store_name: z.string(),
  locale: z.string(),
  emails: z.array(z.string()),
})

/** The Monday of the week containing `date` (local time), as YYYY-MM-DD. */
export function weekStart(date = new Date()) {
  const local = date.toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
  })
  const d = new Date(`${local}T12:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

/** The day before `weekStartIso`, the anchor for last week's brief. */
export function previousSunday(weekStartIso: string) {
  const d = new Date(`${weekStartIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function sendWeeklyBriefs(
  client: SupabaseClient,
  origin: string,
  env: Record<string, string | undefined> = process.env,
  transport = sendSellerEmailWithId,
  now = new Date(),
) {
  const week = weekStart(now)
  const due = await client.rpc('due_weekly_briefs', { p_week_start: week })
  if (due.error) throw new Error('FORBIDDEN')
  const results: { tenantId: string; delivery: string }[] = []
  for (const store of z.array(dueRow).parse(due.data)) {
    const brief = await readEconomyBrief(client, store.tenant_id, {
      kind: 'week',
      anchor: previousSunday(week),
    })
    let delivery = 'none'
    if (brief && store.emails.length > 0) {
      const locale = resolveLocale(undefined, store.locale)
      const t = dictionary(locale)
      const rendered = renderBrief(brief, t.brief)
      const subject = `${rendered.title} · ${store.store_name}`
      const text = `${rendered.lines.join('\n')}\n\n${t.brief.emailFooter.replace('{link}', `${origin}/intake/economy`)}`
      const statuses = (
        await Promise.all(
          store.emails.map((to) =>
            transport(
              {
                communicationId: `weekly-brief/${store.tenant_id}/${week}/${to}`,
                to,
                subject,
                text,
              },
              env,
            ),
          ),
        )
      ).map((o) => o.status)
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
    const r = await client.rpc('record_brief_send', {
      p_tenant: store.tenant_id,
      p_week_start: week,
      p_recipients: store.emails.length,
      p_delivery: delivery,
    })
    if (r.error) throw new Error(r.error.message)
    results.push({ tenantId: store.tenant_id, delivery })
  }
  return { week, results }
}
