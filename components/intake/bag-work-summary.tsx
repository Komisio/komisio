import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import { readBagWorkSummary } from '@/lib/engine/bag-work-summary'

export async function BagWorkSummary({
  client,
  tenantId,
  bagId,
  locale,
}: {
  client: SupabaseClient
  tenantId: string
  bagId: string
  locale: Locale
}) {
  const d = dictionary(locale).bagProgress
  const progress = await readBagWorkSummary(client, tenantId, bagId)
  if (!progress) return <p role="status">{d.unavailable}</p>
  const number = new Intl.NumberFormat(intlLocale(locale))
  return (
    <section className="bag-progress" aria-label={d.title}>
      <h2>{d.title}</h2>
      <dl>
        <div>
          <dt>{d.accepted}</dt>
          <dd data-bag-count="accepted">{number.format(progress.accepted)}</dd>
        </div>
        <div>
          <dt>{d.drafts}</dt>
          <dd data-bag-count="drafts">{number.format(progress.drafts)}</dd>
        </div>
        <div>
          <dt>{d.receptions}</dt>
          <dd data-bag-count="receptions">
            {number.format(progress.receptions)}
          </dd>
        </div>
      </dl>
      {(progress.nextDraft || progress.nextReception) && (
        <nav className="row wrap" aria-label={d.title}>
          {progress.nextDraft && (
            <Link
              className="text-link"
              href={`/intake/bags/${bagId}/inspect?view=drafts&draft=${progress.nextDraft}`}
            >
              {d.resumeDraft} →
            </Link>
          )}
          {progress.nextReception && (
            <Link
              className="text-link"
              href={`/intake/reception/${progress.nextReception}`}
            >
              {d.resumeReception} →
            </Link>
          )}
        </nav>
      )}
      <p>{d.hint}</p>
    </section>
  )
}
