import { WorkingForm } from '@/components/platform/working-form'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { agreementPdfUrl } from '@/lib/documents/agreement-pdf-url'
import { EventTime } from '@/components/ui/event-time'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames, locales } from '@/lib/i18n'
import { readStorePolicy } from '@/lib/engine/store-policy'
import type { SellerAgreement } from '@/lib/engine/intake'
import { readAgreementDraft } from '@/lib/engine/agreement-assistance'
import {
  readAgreementSellers,
  agreementSortKeys,
} from '@/lib/engine/agreement-workspace'
import { directoryOrder } from '@/lib/intake/directory-order'
import {
  CompactDirectory,
  DirectoryOrder,
  type DirectoryColumn,
} from '@/components/ui/compact-directory'
import {
  agreementLinkSummary,
  readSellerAgreementLinks,
} from '@/lib/engine/agreement-deletion'
import { DeleteSellerAgreement } from '@/components/intake/delete-seller-agreement'
import { AgreementTranslationPublisher } from '@/components/intake/agreement-translation-publisher'
import { AgreementPublisher } from '@/components/intake/agreement-forms'
import {
  AgreementTabs,
  AgreementWorkspaceLink,
} from '@/components/intake/agreement-tabs'

const navigation = z.object({
  version: z.uuid().optional(),
  translation: z.uuid().optional(),
  draft: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  sellersPage: z.coerce.number().int().min(1).max(1000000).default(1),
  q: z.string().trim().max(120).default(''),
  order: z.string().max(40).optional(),
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
  const order = directoryOrder(agreementSortKeys, params.order)
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    a = d.agreements,
    w = a.workspace
  const manage = ['owner', 'admin'].includes(active.role)
  const [latest, history, requested, policy] = await Promise.all([
    ctx.client
      .from('seller_agreement_versions')
      .select(
        '*,translations:seller_agreement_translations(id,title,body,language)',
      )
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.client
      .from('seller_agreement_versions')
      .select(
        'id,version,title,language,created_at,translations:seller_agreement_translations(id,title,language)',
        { count: 'exact' },
      )
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .range((params.page - 1) * 20, params.page * 20 - 1),
    params.version
      ? ctx.client
          .from('seller_agreement_versions')
          .select(
            '*,translations:seller_agreement_translations(id,title,body,language)',
          )
          .eq('tenant_id', active.id)
          .eq('id', params.version)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    readStorePolicy(ctx.client, active.id),
  ])
  if (latest.error || history.error || requested.error)
    throw new Error('Unable to load agreements')
  const links =
    manage && history.data?.length
      ? await readSellerAgreementLinks(
          ctx.client,
          active.id,
          history.data.map((v) => v.id),
        )
      : {}
  if (params.version && !requested.data) notFound()
  const current = latest.data as SellerAgreement | null
  const shown = (requested.data ?? current) as SellerAgreement | null
  const translation = shown?.translations?.find(
    (t) => t.id === params.translation,
  )
  if (params.translation && !translation) notFound()
  const text = shown && { ...shown, ...(translation ?? {}) }
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
          order.sort,
          order.direction,
        )
      : null,
  ])
  function href(change: Record<string, string>, tab = 'versions') {
    const next = new URLSearchParams()
    if (params.version) next.set('version', params.version)
    if (params.translation && !change.version)
      next.set('translation', params.translation)
    if (params.page > 1) next.set('page', String(params.page))
    if (params.q) next.set('q', params.q)
    if (order.value !== 'name:asc') next.set('order', order.value)
    if (params.status !== 'all') next.set('status', params.status)
    if (params.sellersPage > 1)
      next.set('sellersPage', String(params.sellersPage))
    for (const [key, value] of Object.entries(change)) next.set(key, value)
    return `/intake/agreements?${next}#${tab === 'document' ? 'agreement-document' : 'agreements-' + tab}`
  }
  const sortableColumns = [
    { key: 'name', label: d.intake.name },
    { key: 'status', label: w.status },
    { key: 'date', label: a.usage.date },
  ]
  const columns: DirectoryColumn[] = [
    sortableColumns[0],
    sortableColumns[1],
    { key: 'source', label: w.source },
    { key: 'language', label: a.translations.acceptedLanguage },
    sortableColumns[2],
  ].map((column) => ({
    ...column,
    mobileLabel: column.key === 'source' ? d.directory.via : null,
    width:
      column.key === 'name'
        ? 26
        : column.key === 'language'
          ? 16
          : column.key === 'date'
            ? 18
            : 20,
    ...(agreementSortKeys.includes(
      column.key as (typeof agreementSortKeys)[number],
    )
      ? {
          href: href(
            {
              order: `${column.key}:${order.sort === column.key && order.direction === 'asc' ? 'desc' : 'asc'}`,
              sellersPage: '1',
            },
            'sellers',
          ),
          order:
            order.sort === column.key
              ? order.direction === 'asc'
                ? ('ascending' as const)
                : ('descending' as const)
              : undefined,
        }
      : {}),
  }))
  const versionPages = Math.max(1, Math.ceil((history.count ?? 0) / 20))
  const sellerPages = Math.max(1, Math.ceil((acceptances?.total ?? 0) / 25))
  const versionContext = shown && (
    <p>
      <strong>{shown.title}</strong> · {a.version} {shown.version} ·{' '}
      {[shown.language, ...(shown.translations ?? []).map((t) => t.language)]
        .map((l) => localeNames[l])
        .join(', ')}{' '}
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
        initial={
          manage && (!current || params.draft)
            ? 'publish'
            : params.version || params.translation
              ? 'languages'
              : 'versions'
        }
        panels={{
          versions: (
            <>
              <section className="card intake-form agreement-history">
                <div className="agreement-section-heading">
                  <h2>{w.versions}</h2>
                  {manage && (
                    <a className="btn btn-primary" href="#agreements-publish">
                      {w.publish}
                    </a>
                  )}
                </div>
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
                          <th>{w.manageLanguages}</th>
                          {manage && (
                            <th className="agreement-history-actions">
                              {w.deletion.actions}
                            </th>
                          )}
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
                              {v.translations
                                ?.map(
                                  (t) =>
                                    ', ' +
                                    localeNames[
                                      t.language as keyof typeof localeNames
                                    ],
                                )
                                .join('')}
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
                            <td data-label={w.languages}>
                              <AgreementWorkspaceLink
                                className="text-link"
                                href={href(
                                  { version: v.id, sellersPage: '1' },
                                  'languages',
                                )}
                              >
                                {w.manageLanguages}
                              </AgreementWorkspaceLink>
                            </td>
                            {manage && (
                              <td
                                className="agreement-history-actions"
                                data-label={w.deletion.actions}
                              >
                                {links[v.id] ? (
                                  <p>
                                    {w.deletion.linked}{' '}
                                    {agreementLinkSummary(
                                      links[v.id] ?? {},
                                      w.deletion.usage,
                                    )}
                                  </p>
                                ) : (
                                  <DeleteSellerAgreement
                                    tenantId={active.id}
                                    agreementId={v.id}
                                    name={`${a.version} ${v.version} · ${v.title}`}
                                    d={w.deletion}
                                  />
                                )}
                              </td>
                            )}
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
            </>
          ),
          languages: (
            <>
              {shown && (
                <section className="card intake-form agreement-language-list">
                  <div className="agreement-section-heading">
                    <h2>{w.languages}</h2>
                    {manage &&
                      shown.id === current?.id &&
                      (shown.translations?.length ?? 0) + 1 <
                        locales.length && (
                        <a className="text-link" href="#agreement-add-language">
                          {a.translations.add}
                        </a>
                      )}
                  </div>
                  {versionContext}
                  <div className="seller-directory-results">
                    <table className="seller-directory-table">
                      <thead>
                        <tr>
                          <th>{a.language}</th>
                          <th>{a.name}</th>
                          <th>{w.status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            id: shown.id,
                            title: shown.title,
                            language: shown.language,
                          },
                          ...(shown.translations ?? []),
                        ].map((t) => (
                          <tr key={t.id}>
                            <td data-label={a.language}>
                              <AgreementWorkspaceLink
                                className="text-link"
                                href={href(
                                  {
                                    version: shown.id,
                                    ...(t.id !== shown.id
                                      ? { translation: t.id }
                                      : {}),
                                  },
                                  'document',
                                )}
                                aria-current={
                                  (translation?.id ?? shown.id) === t.id
                                    ? 'page'
                                    : undefined
                                }
                              >
                                {localeNames[t.language]}
                              </AgreementWorkspaceLink>
                            </td>
                            <td data-label={a.name}>{t.title}</td>
                            <td data-label={w.status}>{w.languagePublished}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {!shown && (
                <section className="card">
                  <p>{a.none}</p>
                </section>
              )}
              {manage && current && (
                <div
                  hidden={shown?.id !== current.id}
                  className="no-print"
                  id="agreement-add-language"
                >
                  <AgreementTranslationPublisher
                    key={active.id}
                    tenantId={active.id}
                    agreement={current}
                    d={d}
                  />
                </div>
              )}
              {shown && text && (
                <section
                  className="card intake-form agreement-reader"
                  id="agreement-document"
                >
                  <p className="agreement-print-store">{active.name}</p>
                  <span className="badge">
                    {shown.id === current?.id ? a.current : a.historical} ·{' '}
                    {a.version} {shown.version}
                  </span>
                  <h2>{text.title}</h2>
                  <p>
                    {a.language}: {localeNames[text.language]}
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
                    <a
                      className="btn btn-secondary"
                      href={agreementPdfUrl({
                        tenantId: active.id,
                        agreementId: shown.id,
                        textId: translation?.id,
                      })}
                      download
                    >
                      {a.pdf.download}
                    </a>
                    <a className="text-link" href="#agreements-sellers">
                      {w.acceptances} →
                    </a>
                  </div>
                  <div
                    className="agreement-text"
                    lang={intlLocale(text.language)}
                  >
                    {text.body}
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
                  <WorkingForm
                    key={`${shown.id}:${params.q}:${params.status}`}
                    action="/intake/agreements#agreements-sellers"
                    className="agreement-filters directory-filters"
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
                    <DirectoryOrder
                      columns={sortableColumns}
                      value={order.value}
                      id="agreement-order"
                      label={d.directory.sortBy}
                      ascending={d.items.directory.sortAsc}
                      descending={d.items.directory.sortDesc}
                    />
                    <button className="btn btn-secondary">
                      {d.intake.searchButton}
                    </button>
                  </WorkingForm>
                  <p>
                    {acceptances && acceptances.sellers.length
                      ? d.sellersList.showingRange
                          .replace(
                            '{from}',
                            String((params.sellersPage - 1) * 25 + 1),
                          )
                          .replace(
                            '{to}',
                            String(
                              (params.sellersPage - 1) * 25 +
                                acceptances.sellers.length,
                            ),
                          )
                          .replace('{total}', String(acceptances.total))
                      : d.sellersList.showingAll.replace(
                          '{total}',
                          String(acceptances?.total ?? 0),
                        )}
                  </p>
                  {acceptances?.sellers.length ? (
                    <CompactDirectory
                      label={w.acceptances}
                      columns={columns}
                      rows={acceptances.sellers.map((s) => ({
                        id: s.id,
                        cells: [
                          <div key="identity" className="directory-identity">
                            <Link
                              className="directory-primary-link"
                              href={`/intake/sellers/${s.id}#seller-terms`}
                            >
                              {s.name}
                            </Link>
                            <div className="directory-contact">
                              <span title={s.email || s.phone}>
                                {s.email || s.phone}
                              </span>
                            </div>
                          </div>,
                          <span key="status" className="badge">
                            {s.acceptance
                              ? w.accepted
                              : d.quickIntake.workspace.agreementPending}
                          </span>,
                          s.acceptance
                            ? s.acceptance.source === 'seller_portal'
                              ? w.portal
                              : d.sellerPortal.staff
                            : '—',
                          s.acceptance?.language
                            ? localeNames[s.acceptance.language]
                            : '—',
                          s.acceptance ? (
                            <time
                              key="date"
                              className="directory-date"
                              dateTime={s.acceptance.at}
                              title={new Date(s.acceptance.at).toLocaleString(
                                intlLocale(ctx.locale),
                                { timeZone: 'Europe/Stockholm' },
                              )}
                            >
                              {new Date(s.acceptance.at).toLocaleDateString(
                                intlLocale(ctx.locale),
                                { timeZone: 'Europe/Stockholm' },
                              )}
                            </time>
                          ) : (
                            '—'
                          ),
                        ],
                      }))}
                    />
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
