import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  isPlatformHost,
  readHostActivity,
  readHostOverview,
} from '@/lib/engine/plans'
import { HostPlans } from '@/components/platform/host-plans'
import { HostAi } from '@/components/platform/host-ai'
import { readAiPlatformSettings } from '@/lib/engine/ai-credits'

/** Platform host overview: every store's plan state and manual activation. */
export default async function Host() {
  const ctx = await requirePlatform()
  if (!(await isPlatformHost(ctx.client))) notFound()
  const d = dictionary(ctx.locale)
  const [rows, activity, ai] = await Promise.all([
    readHostOverview(ctx.client),
    readHostActivity(ctx.client),
    readAiPlatformSettings(ctx.client),
  ])
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{d.platform}</div>
        <h1>{d.plans.hostTitle}</h1>
        <p>{d.plans.hostIntro}</p>
      </div>
      <HostAi settings={ai} stores={rows} d={d.credits.host} />
      <HostPlans
        rows={rows}
        activity={Object.fromEntries(activity)}
        locale={ctx.locale}
        d={d.plans}
      />
    </>
  )
}
