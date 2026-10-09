import { BagProcessing } from './bag-processing'
import {
  readBagProcessing,
  type BagProcessingState,
} from '@/lib/engine/bag-processing'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import { readBagWorkSummary } from '@/lib/engine/bag-work-summary'

export async function BagWorkSummary({
  client,
  tenantId,
  bagId,
  locale,
  processing,
  readonly = true,
}: {
  client: SupabaseClient
  tenantId: string
  bagId: string
  locale: Locale
  processing?: BagProcessingState
  readonly?: boolean
}) {
  const d = dictionary(locale).bagProgress
  const progress = await readBagWorkSummary(client, tenantId, bagId)
  if (!progress) return <p role="status">{d.unavailable}</p>
  const state = processing ?? (await readBagProcessing(client, tenantId, bagId))
  const number = new Intl.NumberFormat(intlLocale(locale))
  return (
    <div className="stack">
      <BagProcessing
        key={`${bagId}:${state.version}`}
        tenantId={tenantId}
        bagId={bagId}
        current={state}
        pending={progress.drafts + progress.receptions > 0}
        readonly={readonly}
        d={dictionary(locale)}
        locale={locale}
      />
      <section className="bag-progress" aria-label={d.title}>
        <h2>{d.title}</h2>
        <dl>
          <div>
            <dt>{d.accepted}</dt>
            <dd data-bag-count="accepted">
              {number.format(progress.accepted)}
            </dd>
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
      </section>
    </div>
  )
}
