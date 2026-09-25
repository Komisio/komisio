import { SellerTabs } from '@/components/intake/seller-tabs'
import { readBagQueue } from '@/lib/engine/bag-queue'
import { readSellerWorkspaceItems } from '@/lib/engine/seller-workspace'
import { EvidenceRecorder } from '@/components/intake/agreement-forms'
import { SellerProfileForm } from '@/components/intake/seller-profile-form'
import {
  initialSellerProfile,
  sellerProfileBody,
} from '@/lib/engine/seller-profile'
import { readStoreProfile } from '@/lib/engine/store-profile'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames, isLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readEffectiveSellerTerms,
  readSellerTermsHistory,
} from '@/lib/engine/seller-terms'
import { SellerTermsForm } from '@/components/intake/seller-terms-form'
import { LedgerAdjustForm } from '@/components/intake/ledger-adjust-form'
import {
  PayoutRequestForm,
  PayoutDecision,
} from '@/components/intake/payout-forms'
import { StatementForm } from '@/components/intake/statement-form'
import { readSellerStatements } from '@/lib/engine/statements'
import { readSellerCommunications } from '@/lib/engine/communications'
import { readPayouts } from '@/lib/engine/payouts'
import { readItems } from '@/lib/engine/items'
import { CommunicationForm } from '@/components/intake/communication-form'
import { PrintJobButton } from '@/components/intake/print-job-button'
import { readPrinters } from '@/lib/engine/printing'
import {
  readSellerBalance,
  readSellerLedger,
  formatSignedOre,
} from '@/lib/engine/seller-ledger'

export default async function Seller({
  params,
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    currency = await readStoreCurrency(ctx.client, tenant.id),
    all = dictionary(ctx.locale),
    d = all.sellerTerms
  const seller = await ctx.client
    .from('sellers')
    .select('id,name,email,phone,created_at,profile,profile_revision')
    .eq('tenant_id', tenant.id)
    .eq('id', id.data)
    .maybeSingle()
  if (seller.error) throw new Error('Unable to read seller')
  if (!seller.data) notFound()
  const [
    terms,
    history,
    balance,
    ledger,
    statements,
    communications,
    payouts,
    items,
  ] = await Promise.all([
    readEffectiveSellerTerms(ctx.client, tenant.id, id.data),
    readSellerTermsHistory(ctx.client, tenant.id, id.data),
    readSellerBalance(ctx.client, tenant.id, id.data),
    readSellerLedger(ctx.client, tenant.id, id.data),
    readSellerStatements(ctx.client, tenant.id, id.data),
    readSellerCommunications(ctx.client, tenant.id, id.data),
    readPayouts(ctx.client, tenant.id, id.data),
    readItems(ctx.client, tenant.id, id.data),
  ])
  const w = all.sellerWorkspace
  const query = await searchParams
  const pageValue = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .safeParse(query.itemsPage ?? 0)
  if (!pageValue.success) notFound()
  const itemsPage = pageValue.data
  const sellerPath = '/intake/sellers/' + id.data
  const [dropoffs, dropoffCount, workspaceItems, agreement] = await Promise.all(
    [
      readBagQueue(ctx.client, tenant.id, {
        seller: id.data,
        older: query.older,
        newer: query.newer,
      }),
      ctx.client
        .from('bag_receipts')
        .select('id', { head: true, count: 'exact' })
        .eq('tenant_id', tenant.id)
        .eq('seller_id', id.data),
      readSellerWorkspaceItems(ctx.client, tenant.id, id.data, itemsPage),
      ctx.client
        .from('seller_agreement_versions')
        .select('id,title,body,version')
        .eq('tenant_id', tenant.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ],
  )
  if (dropoffCount.error || agreement.error)
    throw new Error('Unable to read seller workspace')
  const evidence = agreement.data
    ? await ctx.client
        .from('seller_agreement_evidence')
        .select('id,reference,recorded_at')
        .eq('tenant_id', tenant.id)
        .eq('seller_id', id.data)
        .eq('agreement_id', agreement.data.id)
        .order('recorded_at', { ascending: false })
        .limit(20)
    : { data: [], error: null }
  if (evidence.error)
    throw new Error('Unable to read seller agreement evidence')
  const c = all.communications
  const printers = await readPrinters(ctx.client, tenant.id)
  const sellerItems = items.filter((i) => i.seller_id === id.data)
  const soldLines = sellerItems.length
    ? await ctx.client
        .from('sale_lines')
        .select('id,item_id,seller_credit_ore')
        .eq('tenant_id', tenant.id)
        .in(
          'item_id',
          sellerItems.map((i) => i.id),
        )
        .limit(50)
    : { data: [], error: null }
  if (soldLines.error) throw new Error('Unable to read seller sale references')
  const references = {
    item_accepted: sellerItems.map((i) => ({
      id: i.id,
      label: `${all.items.originKinds[i.origin_kind]} · ${i.id.slice(0, 8)}`,
    })),
    item_sold: (soldLines.data ?? []).map((l) => ({
      id: String(l.id),
      label: `${all.items.originKinds[sellerItems.find((i) => i.id === l.item_id)?.origin_kind ?? 'purchase']} · ${formatSignedOre(Number(l.seller_credit_ore))} ${currency}`,
    })),
    payout_approved: payouts
      .filter((p) => p.status === 'approved')
      .map((p) => ({
        id: p.id,
        label: `${formatSignedOre(p.amount_ore)} ${currency}`,
      })),
    payout_paid: payouts
      .filter((p) => p.status === 'paid')
      .map((p) => ({
        id: p.id,
        label: `${formatSignedOre(p.amount_ore)} ${currency} · ${p.payment_reference}`,
      })),
    statement_issued: statements.map((s) => ({
      id: s.id,
      label: `${s.kind === 'credit_note' ? all.statements.creditNote : all.statements.statement} ${s.number}`,
    })),
  }
  const l = all.ledger,
    st = all.statements
  const today = new Date(),
    monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const isoDay = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const profile = seller.data.profile
    ? sellerProfileBody.parse(seller.data.profile)
    : initialSellerProfile(seller.data)
  const storeProfile = await readStoreProfile(ctx.client, tenant.id)
  const storeLanguage = storeProfile.profile?.language ?? ctx.locale
  const profileHistory = await ctx.client
    .from('seller_profile_versions')
    .select('id,revision,profile,created_at')
    .eq('tenant_id', tenant.id)
    .eq('seller_id', id.data)
    .order('revision', { ascending: false })
    .limit(20)
  if (profileHistory.error)
    throw new Error('Unable to read seller profile history')
  const write = tenant.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <div className="seller-profile">
      <Link className="text-link" href="/intake/sellers">
        ← {all.sellersList.title}
      </Link>
      <div className="page-heading">
        <h1>{seller.data.name}</h1>
        <p>{w.intro}</p>
        <div className="seller-contact">
          {seller.data.email && (
            <a href={`mailto:${seller.data.email}`}>{seller.data.email}</a>
          )}
          {seller.data.phone && (
            <a href={`tel:${seller.data.phone}`}>{seller.data.phone}</a>
          )}
        </div>
      </div>
      {write && (
        <div className="seller-workspace-actions">
          <Link
            className="btn btn-primary"
            href={'/intake?seller=' + id.data + '#new-seller'}
          >
            {all.intake.receive}
          </Link>
        </div>
      )}
      <SellerTabs
        d={w}
        panels={{
          overview: (
            <>
              <div className="seller-summary-grid">
                <section className="card">
                  <h2>{all.sellerProfile.balance}</h2>
                  <strong>
                    {formatSignedOre(balance.availableOre)} {currency}
                  </strong>
                  <span>{l.available}</span>
                  <small>
                    {l.reserved}: {formatSignedOre(balance.reservedOre)}{' '}
                    {currency}
                  </small>
                  <a href="#seller-economy">{w.economy} →</a>
                </section>
                <section className="card">
                  <h2>{w.items}</h2>
                  <strong>{workspaceItems?.total ?? '—'}</strong>
                  <a href="#seller-items">{w.items} →</a>
                </section>
                <section className="card">
                  <h2>{w.dropoffs}</h2>
                  <strong>{dropoffCount.count ?? '—'}</strong>
                  <a href="#seller-dropoffs">{w.dropoffs} →</a>
                </section>
              </div>
              <section className="card intake-form">
                <h2>{w.recent}</h2>
                {ledger.length ? (
                  <ul className="seller-workspace-list">
                    {ledger.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <div>
                          <strong>{l.kinds[e.kind]}</strong>
                          <small>{when(e.occurred_at)}</small>
                        </div>
                        <span>
                          {formatSignedOre(e.amount_ore)} {currency}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{l.empty}</p>
                )}
                <a className="text-link" href="#seller-economy">
                  {all.sellerProfile.transactions} →
                </a>
              </section>
              {profile.notes && (
                <section className="card intake-form seller-note-preview">
                  <h2>{all.sellerDetails.notes}</h2>
                  <p>{profile.notes}</p>
                </section>
              )}
            </>
          ),
          dropoffs: (
            <section className="card intake-form">
              <h2>{w.dropoffs}</h2>
              {write && (
                <Link
                  className="btn btn-primary"
                  href={'/intake?seller=' + id.data + '#new-seller'}
                >
                  {all.intake.receive}
                </Link>
              )}
              <ul className="seller-workspace-list">
                {dropoffs.items.map((bag) => (
                  <li key={bag.id}>
                    <div>
                      <Link
                        className="text-link"
                        href={'/intake/bags/' + bag.id + '/inspect'}
                      >
                        {all.intake.bag} K-{bag.reference}
                      </Link>
                      <small>{when(bag.received_at)}</small>
                      {bag.note && <p>{bag.note}</p>}
                    </div>
                    <Link className="text-link" href={'/intake/bags/' + bag.id}>
                      {all.intake.label}
                    </Link>
                  </li>
                ))}
              </ul>
              {!dropoffs.items.length && <p>{w.noDropoffs}</p>}
              <nav
                className="seller-workspace-actions"
                aria-label={all.intake.bagPages}
              >
                {dropoffs.hasNewer && dropoffs.items[0] && (
                  <Link
                    href={
                      sellerPath +
                      '?newer=' +
                      dropoffs.items[0].reference +
                      '#seller-dropoffs'
                    }
                  >
                    {w.previous}
                  </Link>
                )}
                {dropoffs.hasOlder && dropoffs.items.at(-1) && (
                  <Link
                    href={
                      sellerPath +
                      '?older=' +
                      dropoffs.items.at(-1)!.reference +
                      '#seller-dropoffs'
                    }
                  >
                    {w.next}
                  </Link>
                )}
              </nav>
            </section>
          ),
          items: (
            <section className="card intake-form">
              <h2>{w.items}</h2>
              {!workspaceItems ? (
                <p role="alert">{all.intake.failed}</p>
              ) : (
                <>
                  <p>
                    {w.showing
                      .replace('{shown}', String(workspaceItems.items.length))
                      .replace('{total}', String(workspaceItems.total))}
                  </p>
                  {!workspaceItems.items.length ? (
                    <p>{w.noItems}</p>
                  ) : (
                    <ul className="seller-workspace-list">
                      {workspaceItems.items.map((item) => (
                        <li key={item.id}>
                          <div>
                            <Link
                              className="text-link"
                              href={'/intake/items/' + item.id}
                            >
                              {item.title || all.items.item}
                            </Link>
                            <small>
                              {all.lifecycle.stages[item.stage]} ·{' '}
                              {when(item.acceptedAt)}
                            </small>
                          </div>
                          <strong>
                            {item.priceOre === null
                              ? '—'
                              : formatSignedOre(item.priceOre) + ' ' + currency}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  <nav
                    className="seller-workspace-actions"
                    aria-label={w.items}
                  >
                    {itemsPage > 0 && (
                      <Link
                        href={
                          sellerPath +
                          '?itemsPage=' +
                          (itemsPage - 1) +
                          '#seller-items'
                        }
                      >
                        {w.previous}
                      </Link>
                    )}
                    {(itemsPage + 1) * workspaceItems.limit <
                      workspaceItems.total && (
                      <Link
                        href={
                          sellerPath +
                          '?itemsPage=' +
                          (itemsPage + 1) +
                          '#seller-items'
                        }
                      >
                        {w.next}
                      </Link>
                    )}
                  </nav>
                </>
              )}
            </section>
          ),
          economy: (
            <>
              <section className="card intake-form seller-economy">
                <h2>{all.sellerProfile.balance}</h2>

                <dl className="seller-balances">
                  {[
                    [l.available, balance.availableOre],
                    [l.reserved, balance.reservedOre],
                    [l.credited, balance.creditedOre],
                    [l.paid, balance.paidOre],
                  ].map(([label, amount], index) => (
                    <div
                      key={String(label)}
                      className={index === 0 ? 'seller-balance-primary' : ''}
                    >
                      <dt>{label}</dt>
                      <dd>
                        {formatSignedOre(Number(amount))} {currency}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details className="seller-disclosure seller-payouts">
                  <summary>{all.payouts.title}</summary>
                  <div className="seller-disclosure-body">
                    {write && balance.availableOre > 0 && (
                      <>
                        <h3>{all.payouts.requestHeading}</h3>
                        <p>{all.payouts.requestHint}</p>
                        <PayoutRequestForm
                          key={`${tenant.id}-${id.data}-${balance.availableOre}`}
                          tenantId={tenant.id}
                          currency={currency}
                          sellers={[
                            {
                              id: id.data,
                              name: seller.data.name,
                              availableOre: balance.availableOre,
                            },
                          ]}
                          d={all.payouts}
                          intake={all.intake}
                        />
                      </>
                    )}
                    <p>{all.payouts.notice}</p>
                    {payouts.length === 0 && <p>{all.payouts.empty}</p>}
                    {payouts.map((p) => (
                      <section key={p.id} className="intake-notice">
                        <strong>
                          {formatSignedOre(p.amount_ore)} {currency} ·{' '}
                          {all.payouts.statuses[p.status]}
                        </strong>
                        <p>
                          {when(p.requested_at)}
                          {p.payment_reference
                            ? ` · ${p.payment_reference}`
                            : ''}
                        </p>
                        {write &&
                          (p.status === 'requested' ||
                            p.status === 'approved') && (
                            <PayoutDecision
                              key={`${p.id}-${p.status}`}
                              tenantId={tenant.id}
                              payoutId={p.id}
                              status={p.status}
                              d={all.payouts}
                              intake={all.intake}
                            />
                          )}
                      </section>
                    ))}
                  </div>
                </details>
                <details className="seller-disclosure">
                  <summary>
                    {all.sellerProfile.transactions}{' '}
                    <span>{ledger.length}</span>
                  </summary>
                  <div className="seller-disclosure-body">
                    {ledger.length === 0 && <p>{l.empty}</p>}
                    {ledger.map((e) => (
                      <p key={e.id}>
                        {when(e.occurred_at)} · {l.kinds[e.kind]} ·{' '}
                        {formatSignedOre(e.amount_ore)} {currency}
                        {e.reason ? ` · ${e.reason}` : ''}
                      </p>
                    ))}
                  </div>
                </details>
                {['owner', 'admin'].includes(tenant.role) && (
                  <details className="seller-disclosure">
                    <summary>{l.adjustHeading}</summary>
                    <div className="seller-disclosure-body">
                      <LedgerAdjustForm
                        tenantId={tenant.id}
                        sellerId={id.data}
                        d={l}
                        intake={all.intake}
                      />
                    </div>
                  </details>
                )}
              </section>
              <section className="card intake-form">
                <h2>{st.title}</h2>
                <div className="seller-disclosure-body">
                  {statements.length === 0 && <p>{st.empty}</p>}
                  {statements.map((s) => (
                    <p key={s.id}>
                      <Link
                        className="text-link"
                        href={`/intake/statements/${s.id}`}
                      >
                        {s.kind === 'credit_note'
                          ? st.creditNote
                          : st.statement}{' '}
                        {s.number}
                      </Link>{' '}
                      · {when(s.period_from)} – {when(s.period_to)} ·{' '}
                      {st.closing} {formatSignedOre(s.closing_ore)} {currency}
                    </p>
                  ))}
                  {write && (
                    <>
                      <h3>{st.issueHeading}</h3>
                      <p>{st.issueHint}</p>
                      <StatementForm
                        tenantId={tenant.id}
                        sellerId={id.data}
                        defaultFrom={isoDay(monthStart)}
                        defaultTo={isoDay(today)}
                        d={st}
                        intake={all.intake}
                      />
                    </>
                  )}
                </div>
              </section>
            </>
          ),
          terms: (
            <>
              <section className="card intake-form">
                <h2>{all.agreements.current}</h2>
                {agreement.data ? (
                  <>
                    <h3>
                      {agreement.data.title} · {all.agreements.version}{' '}
                      {agreement.data.version}
                    </h3>
                    <p>
                      {evidence.data?.length
                        ? all.agreements.available
                        : all.agreements.missing}
                    </p>
                    <details>
                      <summary>{all.agreements.view}</summary>
                      <p style={{ whiteSpace: 'pre-wrap' }}>
                        {agreement.data.body}
                      </p>
                    </details>
                    {evidence.data?.map((e) => (
                      <p key={e.id}>
                        {when(e.recorded_at)} · {e.reference}
                      </p>
                    ))}
                    {write && (
                      <details className="seller-disclosure">
                        <summary>{all.agreements.evidenceHeading}</summary>
                        <EvidenceRecorder
                          key={agreement.data.id}
                          tenantId={tenant.id}
                          sellerId={id.data}
                          agreementId={agreement.data.id}
                          d={all}
                        />
                      </details>
                    )}
                  </>
                ) : (
                  <p>{all.agreements.none}</p>
                )}
                <Link className="text-link" href="/intake/agreements">
                  {all.agreements.manage}
                </Link>
              </section>
              <section className="card intake-form">
                <h2>{d.effective}</h2>

                <p role="status">
                  <strong>
                    {d.commissionRatePercent}: {terms.commissionRatePercent} %
                  </strong>{' '}
                  ·{' '}
                  {terms.overrides.commissionRatePercent
                    ? d.override
                    : d.fromPolicy}
                </p>
                <p role="status">
                  <strong>
                    {d.commissionBasis}: {d[terms.commissionBasis]}
                  </strong>{' '}
                  ·{' '}
                  {terms.overrides.commissionBasis ? d.override : d.fromPolicy}
                </p>
                {terms.notes && <p>{terms.notes}</p>}

                {write && (
                  <details className="seller-disclosure">
                    <summary>{all.sellerProfile.editTerms}</summary>
                    <div className="seller-disclosure-body">
                      <p>{d.intro}</p>
                      <p>{d.publishHint}</p>
                      <SellerTermsForm
                        key={terms.sellerTermsId ?? 'none'}
                        tenantId={tenant.id}
                        sellerId={id.data}
                        current={terms}
                        d={d}
                        intake={all.intake}
                      />
                    </div>
                  </details>
                )}
              </section>
              <details className="card seller-section">
                <summary>{d.history}</summary>
                <div className="seller-disclosure-body">
                  {history.length === 0 && <p>{d.noHistory}</p>}
                  {history.map((v) => (
                    <p key={v.id}>
                      {d.version} {v.version} · {when(v.created_at)} ·{' '}
                      {v.commission_rate_percent === null
                        ? d.usePolicy
                        : `${v.commission_rate_percent} %`}{' '}
                      ·{' '}
                      {v.commission_basis ? d[v.commission_basis] : d.usePolicy}
                      {v.notes ? ` · ${v.notes}` : ''}
                    </p>
                  ))}
                </div>
              </details>
            </>
          ),
          communication: (
            <>
              <section className="card intake-form">
                <h2>{c.title}</h2>
                <div className="seller-disclosure-body">
                  {communications.length === 0 && <p>{c.empty}</p>}
                  {communications.map((m) => (
                    <details key={m.id}>
                      <summary>
                        {when(m.queued_at)} · {c.kinds[m.kind]} ·{' '}
                        {c.outcomes[m.status]} · {m.subject}
                      </summary>
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{m.body}</pre>
                    </details>
                  ))}
                  {write && (
                    <>
                      <h3>{c.sendHeading}</h3>

                      <CommunicationForm
                        tenantId={tenant.id}
                        sellerId={id.data}
                        references={references}
                        d={c}
                        intake={all.intake}
                      />
                    </>
                  )}
                </div>
              </section>
              {write && (
                <details className="card seller-section">
                  <summary>{all.printing.onboardingSlip}</summary>
                  <div className="seller-disclosure-body">
                    <p>{all.printing.onboardingHint}</p>
                    <PrintJobButton
                      tenantId={tenant.id}
                      printers={printers}
                      kind="onboarding"
                      referenceKind="seller"
                      referenceId={id.data}
                      d={all.printing}
                      intake={all.intake}
                    />
                  </div>
                </details>
              )}
            </>
          ),
          details: (
            <>
              <section className="card intake-form">
                {(profile.addressLine1 ||
                  profile.addressLine2 ||
                  profile.postalCode ||
                  profile.city ||
                  profile.country) && (
                  <p>
                    {[
                      profile.addressLine1,
                      profile.addressLine2,
                      [profile.postalCode, profile.city]
                        .filter(Boolean)
                        .join(' '),
                      profile.country,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
                <p>
                  {all.sellerDetails.language}:{' '}
                  {isLocale(profile.language)
                    ? localeNames[profile.language]
                    : `${all.sellerDetails.followStore} (${localeNames[storeLanguage]})`}
                </p>
                {profile.notes && (
                  <p className="seller-internal-note">
                    <strong>{all.sellerDetails.notes}</strong>
                    <br />
                    {profile.notes}
                  </p>
                )}
                {write && (
                  <details className="seller-disclosure">
                    <summary>{all.sellerDetails.edit}</summary>
                    <div className="seller-disclosure-body">
                      <SellerProfileForm
                        key={seller.data.profile_revision}
                        tenantId={tenant.id}
                        sellerId={id.data}
                        revision={seller.data.profile_revision}
                        profile={profile}
                        d={all.sellerDetails}
                        intake={all.intake}
                        storeLanguage={localeNames[storeLanguage]}
                      />
                    </div>
                  </details>
                )}
              </section>
              {profileHistory.data.length > 0 && (
                <details className="card seller-section">
                  <summary>{all.sellerDetails.history}</summary>
                  <div className="seller-disclosure-body">
                    {profileHistory.data.map((row) => {
                      const previous = sellerProfileBody.parse(row.profile)
                      return (
                        <details key={row.id}>
                          <summary>
                            {when(row.created_at)} · {previous.name}
                          </summary>
                          <p>
                            {[previous.email, previous.phone]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <p>
                            {[
                              previous.addressLine1,
                              previous.addressLine2,
                              previous.postalCode,
                              previous.city,
                              previous.country,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </p>
                          <p>
                            {all.sellerDetails.language}:{' '}
                            {isLocale(previous.language)
                              ? localeNames[previous.language]
                              : all.sellerDetails.followStore}
                          </p>
                          {previous.notes && (
                            <p>
                              <strong>{all.sellerDetails.notes}</strong>:{' '}
                              {previous.notes}
                            </p>
                          )}
                        </details>
                      )
                    })}
                  </div>
                </details>
              )}
              {['owner', 'admin'].includes(tenant.role) && (
                <p>
                  <a
                    className="text-link"
                    href={`/api/sellers/${id.data}/export`}
                  >
                    {all.intake.exportSellerData}
                  </a>
                </p>
              )}
            </>
          ),
        }}
      />
    </div>
  )
}
