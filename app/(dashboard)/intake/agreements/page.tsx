import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { PrintLabel } from '@/components/intake/print-label'
import { EventTime } from '@/components/ui/event-time'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames } from '@/lib/i18n'
import { readStorePolicy } from '@/lib/engine/store-policy'
import type { SellerAgreement } from '@/lib/engine/intake'
import { readAgreementDraft } from '@/lib/engine/agreement-assistance'
import { readAgreementSellers } from '@/lib/engine/agreement-workspace'
import { AgreementPublisher } from '@/components/intake/agreement-forms'
import {
  AgreementTabs,
  AgreementWorkspaceLink,
} from '@/components/intake/agreement-tabs'

const navigation = z.object({
  version: z.uuid().optional(),
  draft: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  sellersPage: z.coerce.number().int().min(1).max(1000000).default(1),
  q: z.string().trim().max(120).default(''),
  status: z.enum(['all', 'accepted', 'missing']).default('all'),
})
export default async function Agreements({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const parsed = navigation.safeParse(await searchParams)
  if (!parsed.success) notFound()
  const params = parsed.data
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    a = d.agreements,
    w = a.workspace
  const manage = ['owner', 'admin'].includes(active.role)
  const [latest, history, requested, policy] = await Promise.all([
    ctx.client
      .from('seller_agreement_versions')
      .select('*')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.client
      .from('seller_agreement_versions')
      .select('id,version,title,language,created_at', { count: 'exact' })
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .range((params.page - 1) * 20, params.page * 20 - 1),
    params.version
      ? ctx.client
          .from('seller_agreement_versions')
          .select('*')
          .eq('tenant_id', active.id)
          .eq('id', params.version)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    readStorePolicy(ctx.client, active.id),
  ])
  if (latest.error || history.error || requested.error)
    throw new Error('Unable to load agreements')
  if (params.version && !requested.data) notFound()
  const current = latest.data as SellerAgreement | null
  const shown = (requested.data ?? current) as SellerAgreement | null
  const [draft, acceptances] = await Promise.all([
    manage
      ? readAgreementDraft(
          ctx.client,
          active.id,
          ctx.user.id,
          current?.id ?? null,
          params.draft,
        )
      : null,
    shown
      ? readAgreementSellers(
          ctx.client,
          active.id,
          shown.id,
          params.q,
          params.status,
          params.sellersPage,
        )
      : null,
  ])
  function href(change: Record<string, string>, tab = 'versions') {
    const next = new URLSearchParams()
    if (params.version) next.set('version', params.version)
    if (params.page > 1) next.set('page', String(params.page))
    if (params.q) next.set('q', params.q)
    if (params.status !== 'all') next.set('status', params.status)
    if (params.sellersPage > 1)
      next.set('sellersPage', String(params.sellersPage))
    for (const [key, value] of Object.entries(change)) next.set(key, value)
    return `/intake/agreements?${next}#${tab === 'document' ? 'agreement-document' : 'agreements-' + tab}`
  }
  const versionPages = Math.max(1, Math.ceil((history.count ?? 0) / 20))
  const sellerPages = Math.max(1, Math.ceil((acceptances?.total ?? 0) / 25))
  const versionContext = shown && (
    <p>
      <strong>{shown.title}</strong> · {a.version} {shown.version} ·{' '}
      {localeNames[shown.language]}{' '}
      <span className="badge">
        {shown.id === current?.id ? w.active : w.historical}
      </span>
    </p>
  )
  return (
    <div className="agreements-page">
      <div className="page-heading">
        <FormHelpHeading
          title={a.title}
          level={1}
          help={{
            label: a.usage.helpLabel,
            steps: [a.usage.prepare, a.usage.accept, a.usage.record],
          }}
        />
      </div>
      <AgreementTabs
        key={active.id}
        labels={w}
        initial={manage && (!current || params.draft) ? 'publish' : 'versions'}
        panels={{
          versions: (
            <>
              <section className="card intake-form agreement-history">
                <h2>{w.versions}</h2>
                {!current && <p>{a.none}</p>}
                {!!history.data?.length && (
                  <div className="seller-directory-results">
                    <table className="seller-directory-table">
                      <thead>
                        <tr>
                          <th>{a.name}</th>
                          <th>{a.language}</th>
                          <th>{w.publishedAt}</th>
                          <th>{w.status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.data.map((v) => (
                          <tr key={v.id}>
                            <td data-label={a.name}>
                              <AgreementWorkspaceLink
                                className="text-link"
                                href={href(
                                  { version: v.id, sellersPage: '1' },
                                  'document',
                                )}
                                aria-current={
                                  v.id === shown?.id ? 'page' : undefined
                                }
                              >
                                {a.version} {v.version} · {v.title}
                              </AgreementWorkspaceLink>
                            </td>
                            <td data-label={a.language}>
                              {
                                localeNames[
                                  v.language as keyof typeof localeNames
                                ]
                              }
                            </td>
                            <td data-label={w.publishedAt}>
                              <EventTime
                                value={v.created_at}
                                locale={ctx.locale}
                              />
                            </td>
                            <td data-label={w.status}>
                              <span className="badge">
                                {v.id === current?.id ? w.active : w.historical}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {versionPages > 1 && (
                  <nav className="pagination" aria-label={w.versions}>
                    {params.page > 1 && (
                      <AgreementWorkspaceLink
                        className="btn btn-secondary"
                        href={href({ page: String(params.page - 1) })}
                      >
                        {w.previous}
                      </AgreementWorkspaceLink>
                    )}
                    <span>
                      {params.page} / {versionPages}
                    </span>
                    {params.page < versionPages && (
                      <AgreementWorkspaceLink
                        className="btn btn-secondary"
                        href={href({ page: String(params.page + 1) })}
                      >
                        {w.next}
                      </AgreementWorkspaceLink>
                    )}
                  </nav>
                )}
              </section>
              {shown && (
                <section
                  className="card intake-form agreement-reader"
                  id="agreement-document"
                >
                  <p className="agreement-print-store">{active.name}</p>
                  <span className="badge">
                    {shown.id === current?.id ? a.current : a.historical} ·{' '}
                    {a.version} {shown.version}
                  </span>
                  <h2>{shown.title}</h2>
                  <p>
                    {a.language}: {localeNames[shown.language]}
                  </p>
                  {shown.id !== current?.id && (
                    <AgreementWorkspaceLink
                      className="text-link"
                      href="/intake/agreements"
                    >
                      {a.current}
                    </AgreementWorkspaceLink>
                  )}
                  {shown.id === current?.id && (
                    <p className="no-print">
                      {shown.required_before_receipt ||
                      policy.policy.agreementRequiredFor.includes('bag_receipt')
                        ? a.required
                        : a.optional}
                    </p>
                  )}
                  <div className="no-print agreement-print-actions">
                    <PrintLabel label={a.usage.print} />
                    <a className="text-link" href="#agreements-sellers">
                      {w.acceptances} →
                    </a>
                  </div>
                  <div
                    className="agreement-text"
                    lang={intlLocale(shown.language)}
                  >
                    {shown.body}
                  </div>
                  <div className="agreement-signatures">
                    {[
                      a.usage.sellerName,
                      a.usage.date,
                      a.usage.sellerSignature,
                      a.usage.storeSignature,
                    ].map((label) => (
                      <div key={label}>
                        <span>{label}</span>
                        <div />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ),
          sellers: (
            <section className="card intake-form agreement-acceptances">
              <h2>{w.acceptances}</h2>
              {versionContext}
              {shown ? (
                <>
                  <p>{w.versionHint}</p>
                  <form
                    key={`${shown.id}:${params.q}:${params.status}`}
                    action="/intake/agreements#agreements-sellers"
                    className="agreement-filters"
                  >
                    <input type="hidden" name="version" value={shown.id} />
                    <div className="field">
                      <label htmlFor="agreement-seller-search">
                        {w.search}
                      </label>
                      <input
                        id="agreement-seller-search"
                        name="q"
                        type="search"
                        maxLength={120}
                        defaultValue={params.q}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="agreement-status">{w.status}</label>
                      <select
                        id="agreement-status"
                        name="status"
                        defaultValue={params.status}
                      >
                        <option value="all">{w.all}</option>
                        <option value="accepted">{w.accepted}</option>
                        <option value="missing">{w.missing}</option>
                      </select>
                    </div>
                    <button className="btn btn-secondary">
                      {d.intake.searchButton}
                    </button>
                  </form>
                  <p>
                    {d.sellersList.showingAll.replace(
                      '{total}',
                      String(acceptances?.total ?? 0),
                    )}
                  </p>
                  {acceptances?.sellers.length ? (
                    <div className="seller-directory-results">
                      <table className="seller-directory-table">
                        <thead>
                          <tr>
                            <th>{d.intake.name}</th>
                            <th>{w.status}</th>
                            <th>{w.source}</th>
                            <th>{a.usage.date}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {acceptances.sellers.map((s) => (
                            <tr key={s.id}>
                              <td data-label={d.intake.name}>
                                <Link
                                  className="text-link"
                                  href={`/intake/sellers/${s.id}#seller-terms`}
                                >
                                  {s.name}
                                </Link>
                                <small className="seller-directory-city">
                                  {s.email || s.phone}
                                </small>
                              </td>
                              <td data-label={w.status}>
                                <span className="badge">
                                  {s.acceptance ? w.accepted : w.missing}
                                </span>
                              </td>
                              <td data-label={w.source}>
                                {s.acceptance
                                  ? s.acceptance.source === 'seller_portal'
                                    ? w.portal
                                    : w.staff
                                  : '—'}
                              </td>
                              <td data-label={a.usage.date}>
                                {s.acceptance ? (
                                  <EventTime
                                    value={s.acceptance.at}
                                    locale={ctx.locale}
                                  />
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>{w.noSellers}</p>
                  )}
                  {sellerPages > 1 && (
                    <nav className="pagination" aria-label={w.acceptances}>
                      {params.sellersPage > 1 && (
                        <AgreementWorkspaceLink
                          className="btn btn-secondary"
                          href={href(
                            { sellersPage: String(params.sellersPage - 1) },
                            'sellers',
                          )}
                        >
                          {w.previous}
                        </AgreementWorkspaceLink>
                      )}
                      <span>
                        {params.sellersPage} / {sellerPages}
                      </span>
                      {params.sellersPage < sellerPages && (
                        <AgreementWorkspaceLink
                          className="btn btn-secondary"
                          href={href(
                            { sellersPage: String(params.sellersPage + 1) },
                            'sellers',
                          )}
                        >
                          {w.next}
                        </AgreementWorkspaceLink>
                      )}
                    </nav>
                  )}
                </>
              ) : (
                <p>{a.none}</p>
              )}
            </section>
          ),
          ...(manage
            ? {
                publish: (
                  <AgreementPublisher
                    tenantId={active.id}
                    current={current}
                    draft={draft}
                    locale={ctx.locale}
                    d={d}
                  />
                ),
              }
            : {}),
        }}
      />
    </div>
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.agreements.title)
