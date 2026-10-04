import './host.css'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  isPlatformHost,
  readHostActivity,
  readHostOverview,
  readPlanStatus,
} from '@/lib/engine/plans'
import { HostPlans } from '@/components/platform/host-plans'
import { HostAi } from '@/components/platform/host-ai'
import { readAiPlatformSettings } from '@/lib/engine/ai-credits'

/** Platform host overview: every store's plan state and manual activation. */
export default async function Host() {
  const ctx = await requirePlatform()
  if (!(await isPlatformHost(ctx.client))) notFound()
  const d = dictionary(ctx.locale)
  const [rows, activity, ai, plan] = await Promise.all([
    readHostOverview(ctx.client),
    readHostActivity(ctx.client),
    readAiPlatformSettings(ctx.client),
    readPlanStatus(ctx.client, ctx.active!.id),
  ])
  return (
    <div className="host-console">
      <div className="page-heading">
        <div className="eyebrow">{d.platform}</div>
        <h1>{d.plans.hostTitle}</h1>
        <p>{d.plans.hostIntro}</p>
      </div>
      <HostPlans
        rows={rows}
        billingEnabled={plan?.billing === true}
        activity={Object.fromEntries(activity)}
        locale={ctx.locale}
        d={d.plans}
      />
      <HostAi settings={ai} stores={rows} d={d.credits.host} />
      <div className="host-privacy">
        <Link
          className="text-link"
          href="/intake/integrations/privacy?unmatched=1"
        >
          {d.shopifyPrivacy.unmatched}
        </Link>
      </div>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.plans.hostTitle)
