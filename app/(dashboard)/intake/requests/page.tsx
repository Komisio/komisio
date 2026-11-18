import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { centralOfferQueueVisible } from '@/lib/platform/central-offer-queue'
import { dictionary } from '@/lib/i18n'
import { readExternalOfferQueue } from '@/lib/engine/external-item-offers'
import {
  externalRequestFilters,
  externalRequestHref,
} from '@/lib/platform/external-request-filters'
import { ExternalRequestFilters } from '@/components/intake/external-request-filters'
import { ExternalRequestQueue } from '@/components/intake/external-request-queue'
import { AutomationSwitch } from '@/components/intake/automation-switch'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import styles from '@/components/intake/external-request-queue.module.css'
import '@/app/seller/submissions/submissions.css'

export default async function ExternalRequests({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[]
    status?: string | string[]
    q?: string | string[]
  }>
}) {
  const ctx = await requirePlatform(),
    tenant = ctx.active!
  if (!(await centralOfferQueueVisible(ctx.client, tenant.id))) notFound()
  const all = dictionary(ctx.locale),
    d = all.externalOffers,
    t = d.queue
  const params = await searchParams,
    filters = externalRequestFilters(params)
  const page =
    typeof params.page === 'string' && /^[1-9]\d{0,3}$/.test(params.page)
      ? Math.min(4001, Number(params.page))
      : 1
  const { rows, total } = await readExternalOfferQueue(
    ctx.client,
    tenant.id,
    page,
    filters,
  )
  const pages = Math.max(1, Math.ceil(total / 25))
  if (page > pages) redirect(externalRequestHref(filters, pages))
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.agreement_version_id ? [row.agreement_version_id] : [],
      ),
    ),
  ]
  const agreements = ids.length
    ? await ctx.client
        .from('seller_agreement_versions')
        .select('id,version,title,body')
        .eq('tenant_id', tenant.id)
        .in('id', ids)
    : { data: [], error: null }
  if (agreements.error) throw new Error('REQUEST_FAILED')
  const filtered = filters.status !== 'all' || Boolean(filters.query)
  const recipient =
    tenant.role === 'owner'
      ? await ctx.client.rpc('public_central_app_recipient')
      : null
  const centralOwner = !recipient?.error && recipient?.data?.id === tenant.id
  const grants = centralOwner
    ? await readAutomation(ctx.client, tenant.id)
    : null
  const configured =
    process.env.KOMISIO_CENTRAL_GUARANTEES_ENABLED === 'true' &&
    automationIdentity() !== null &&
    (process.env.CRON_SECRET?.length ?? 0) >= 16
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </header>
      {centralOwner && (
        <details>
          <summary>{d.guaranteeAutomation.heading}</summary>
          <AutomationSwitch
            key={`guarantees-${tenant.id}`}
            tenantId={tenant.id}
            scope="central_guarantees"
            grants={grants}
            configured={configured}
            canEdit
            t={{
              ...all.accounting.dayCloseAutomation,
              ...d.guaranteeAutomation,
              ...(!configured
                ? {
                    enabled: d.guaranteeAutomation.notConfigured,
                    waiting: d.guaranteeAutomation.notConfigured,
                  }
                : {}),
            }}
          />
        </details>
      )}
      <ExternalRequestFilters
        key={externalRequestHref(filters)}
        filters={filters}
        d={t}
      />
      <div className={styles.results}>
        <strong>{t.results.replace('{count}', String(total))}</strong>
        <span>{t.newest}</span>
      </div>
      {rows.length ? (
        <ExternalRequestQueue
          rows={rows}
          agreements={agreements.data ?? []}
          tenantId={tenant.id}
          write={tenant.role !== 'readonly'}
          locale={ctx.locale}
          d={d}
          leaveWarning={all.leaveUnsaved}
        />
      ) : (
        <div className={styles.empty}>
          <h2>{filtered ? t.noResults : d.empty}</h2>
          {filtered ? (
            <>
              <p>{t.noResultsHint}</p>
              <Link className="btn btn-secondary" href="/intake/requests">
                {t.reset}
              </Link>
            </>
          ) : null}
        </div>
      )}
      {pages > 1 ? (
        <nav className={styles.pagination} aria-label={d.title}>
          {page > 1 ? (
            <Link
              className="btn btn-secondary"
              href={externalRequestHref(filters, page - 1)}
            >
              {d.previous}
            </Link>
          ) : null}
          <span>
            {t.page
              .replace('{page}', String(page))
              .replace('{pages}', String(pages))}
          </span>
          {page < pages ? (
            <Link
              className="btn btn-secondary"
              href={externalRequestHref(filters, page + 1)}
            >
              {d.next}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
