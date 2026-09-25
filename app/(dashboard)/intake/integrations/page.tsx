import { FortnoxConnection } from '@/components/intake/fortnox-connection'
import { paypalEnvironment } from '@/lib/engine/paypal-credentials'
import { credentialKeyConfigured } from '@/lib/platform/credentials'
import { readFortnoxStatus } from '@/lib/engine/fortnox-connection'
import { fortnoxEnvironment, fortnoxIssue } from '@/extensions/fortnox/auth'
import { readZettleStock } from '@/lib/engine/zettle-stock'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { readAutomaticPullStatus } from '@/lib/engine/zettle-automation'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { vatRateBasisPoints } from '@/lib/engine/vat'
import { readZettleImages } from '@/lib/engine/zettle-images'
import {
  readZettlePull,
  readZettleWindowClosure,
} from '@/lib/engine/zettle-live'
import Link from 'next/link'
import { pilotIssue, pilotEnvironment } from '@/extensions/zettle/auth'
import { ZettleConnection } from '@/components/intake/zettle-connection'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readZettleStatus,
  readZettleCatalog,
  zettlePageCursor,
} from '@/lib/engine/zettle'
import { zettleFixturesEnabled } from '@/extensions/zettle/fixtures'
import { ZettleAction } from '@/components/intake/zettle-action'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import {
  readShopifyStatus,
  shopifyTokenExpired,
} from '@/lib/engine/shopify-connection'
import { shopifyEnvironment, shopifyIssue } from '@/extensions/shopify/auth'
import { ShopifySetup } from '@/components/intake/shopify-setup'
import { readShopifySettings } from '@/lib/engine/shopify-settings'
import { ShopifyConnection } from '@/components/intake/shopify-connection'
import { ShopifyProducts } from '@/components/intake/shopify-products'
import { ShopifyOrders } from '@/components/intake/shopify-orders'
import { readShopifyOrderStatus } from '@/lib/engine/shopify-orders'
import { readShopifyAutomaticStatus } from '@/lib/engine/shopify-automation'
import { AutomationSwitch } from '@/components/intake/automation-switch'
import {
  readShopifyCandidates,
  readShopifyProductStatus,
} from '@/lib/engine/shopify-products'
export default async function Integrations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const params = await searchParams
  const paging =
    params.before || params.id
      ? zettlePageCursor.safeParse({ before: params.before, id: params.id })
      : null
  if (paging && !paging.success) notFound()
  const ctx = await requirePlatform(),
    a = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.zettle,
    state = await readZettleStatus(
      ctx.client,
      a.id,
      paging?.success ? paging.data : undefined,
    ),
    fixtures = zettleFixturesEnabled(),
    catalog = await readZettleCatalog(ctx.client, a.id),
    pull = ['owner', 'admin'].includes(a.role)
      ? await readZettlePull(ctx.client, a.id)
      : null,
    pilot = ['owner', 'admin'].includes(a.role)
      ? await paypalEnvironment(ctx.client, a.id, process.env)
      : pilotEnvironment({}),
    liveReady = pilotIssue(a.id, pilot) === null && !!pilot.ZETTLE_MERCHANT_ID
  const stocks = ['owner', 'admin'].includes(a.role)
    ? await readZettleStock(ctx.client, a.id)
    : []
  const engineVat = ['owner', 'admin'].includes(a.role)
    ? vatRateBasisPoints((await readStorePolicy(ctx.client, a.id)).policy)
    : undefined

  const closure = pull?.window
    ? await readZettleWindowClosure(ctx.client, a.id, pull.window.id)
    : null
  const automation = ['owner', 'admin'].includes(a.role)
    ? await readAutomation(ctx.client, a.id)
    : null
  const automaticStatus = ['owner', 'admin'].includes(a.role)
    ? await readAutomaticPullStatus(ctx.client, a.id)
    : null
  const automaticGrant = automation?.find(
    (grant) => grant.scope === 'zettle_pull',
  )
  const images =
    a.role === 'staff' || (liveReady && pull?.connection)
      ? await readZettleImages(ctx.client, a.id)
      : []
  const exportItems = [
    ...new Set([
      ...catalog.candidates.map((c) => c.item_id),
      ...stocks.map((s) => s.item_id),
      ...(images ?? []).map((image) => image.item_id),
    ]),
  ]
  const fortnoxStatus = await readFortnoxStatus(ctx.client, a.id)
  const shopifyStatus = await readShopifyStatus(ctx.client, a.id)
  const shopifySettings = shopifyStatus.connected
    ? await readShopifySettings(ctx.client, a.id)
    : null
  const shopifyExpired = shopifyTokenExpired(shopifyStatus)
  const [shopifyCandidates, shopifyProducts, shopifyOrders, shopifyAuto] =
    shopifyStatus.connected
      ? await Promise.all([
          readShopifyCandidates(ctx.client, a.id),
          readShopifyProductStatus(ctx.client, a.id),
          readShopifyOrderStatus(ctx.client, a.id),
          ['owner', 'admin'].includes(a.role)
            ? readShopifyAutomaticStatus(ctx.client, a.id)
            : null,
        ])
      : [null, null, null, null]
  return (
    <>
      <div className="page-heading">
        <h1>{all.nav.integrations}</h1>
        <p>{all.integrationPage.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      {['owner', 'admin'].includes(a.role) && (
        <Link className="text-link" href="/intake/integrations/privacy">
          {all.shopifyPrivacy.title}
        </Link>
      )}
      {!['owner', 'admin'].includes(a.role) && (
        <p>{all.integrationPage.adminOnly}</p>
      )}
      <section className="integration-group" aria-labelledby="integration-pos">
        <h2 id="integration-pos">{all.integrationPage.pos}</h2>
        {['owner', 'admin'].includes(a.role) && (
          <ZettleConnection
            key={a.id}
            tenantId={a.id}
            issue={pilotIssue(a.id, pilot)}
            setupAvailable={credentialKeyConfigured(process.env)}
            d={d}
          />
        )}
        <details className="card integration-details" open={Boolean(paging)}>
          <summary>PayPal POS · {all.integrationPage.manage}</summary>
          {a.role === 'staff' && images !== null && images.length > 0 && (
            <section
              className="card intake-form"
              aria-label={d.imageStatusTitle}
            >
              <h2>{d.imageStatusTitle}</h2>
              {images.map((image) => (
                <p key={image.item_id}>
                  <Link
                    className="text-link"
                    href={`/intake/items/${image.item_id}`}
                  >
                    I-{image.item_id.slice(0, 8).toUpperCase()}
                  </Link>{' '}
                  · {d.imageStates[image.status]}
                </p>
              ))}
            </section>
          )}
          {liveReady && pull && (
            <section className="card intake-form" aria-label={d.pullTitle}>
              <h2>{d.pullTitle}</h2>
              <p>{d.pullHint}</p>
              {pull.connection ? (
                <>
                  <p>
                    {d.pullSince}:{' '}
                    {new Date(pull.connection.cutover).toLocaleString(
                      ctx.locale,
                      {
                        timeZone: 'Europe/Stockholm',
                      },
                    )}
                  </p>
                  {automation !== null && automaticStatus?.available && (
                    <div>
                      <h3>{d.automaticTitle}</h3>
                      <p>{d.automaticHint}</p>
                      <p>
                        {automaticGrant
                          ? automaticGrant.accepted
                            ? d.automaticEnabled
                            : d.automaticPending
                          : d.automaticDisabled}
                      </p>
                      {automaticStatus.run && (
                        <p>
                          {new Date(automaticStatus.run.at).toLocaleString(
                            ctx.locale,
                            { timeZone: 'Europe/Stockholm' },
                          )}
                          {' · '}
                          {d.automaticOutcomes[automaticStatus.run.outcome]}
                          {' · '}
                          {automaticStatus.run.received}
                        </p>
                      )}
                      {a.role === 'owner' &&
                        (automaticGrant || automationIdentity()) && (
                          <ZettleAction
                            key={automaticGrant?.id ?? 'automatic-off'}
                            command={{
                              action: automaticGrant
                                ? 'disableAutomaticPull'
                                : 'enableAutomaticPull',
                              tenantId: a.id,
                            }}
                            d={d}
                            label={
                              automaticGrant
                                ? d.automaticDisable
                                : d.automaticEnable
                            }
                          />
                        )}
                      {!automationIdentity() && (
                        <p>{d.automaticUnconfigured}</p>
                      )}
                    </div>
                  )}
                  {pull.window && (
                    <p>
                      {closure?.closure
                        ? d.abandoned
                        : pull.page?.purchase_count === 0
                          ? d.pullComplete
                          : d.pullPending}
                      :{' '}
                      {new Date(pull.window.end_at).toLocaleString(ctx.locale, {
                        timeZone: 'Europe/Stockholm',
                      })}
                    </p>
                  )}
                  <ZettleAction
                    key={
                      closure?.closure?.id ??
                      pull.page?.id ??
                      pull.window?.id ??
                      'pull'
                    }
                    command={{ action: 'pull', tenantId: a.id }}
                    d={d}
                    label={d.pullNow}
                  />
                  {closure?.closure && (
                    <p>
                      {d.abandonReason}: {closure.closure.reason}
                    </p>
                  )}
                  {a.role === 'owner' &&
                    pull.window &&
                    closure?.available &&
                    !closure.closure &&
                    pull.page?.purchase_count !== 0 && (
                      <details>
                        <summary>{d.abandonWindow}</summary>
                        <ZettleAction
                          key={pull.window.id}
                          command={{
                            action: 'abandonWindow',
                            tenantId: a.id,
                            windowId: pull.window.id,
                            reason: '',
                          }}
                          d={d}
                          label={d.abandonWindow}
                        />
                      </details>
                    )}
                </>
              ) : (
                <ZettleAction
                  command={{ action: 'enablePull', tenantId: a.id }}
                  d={d}
                  label={d.pullEnable}
                />
              )}
            </section>
          )}
          <section className="card intake-form">
            <p className="intake-notice">
              {fixtures
                ? d.fixture
                : pull?.connection
                  ? d.catalogOffline
                  : d.offline}
            </p>
            <p>
              {d.lastSync}:{' '}
              {state.lastSync
                ? new Date(state.lastSync).toLocaleString(ctx.locale, {
                    timeZone: 'Europe/Stockholm',
                  })
                : d.never}
            </p>
            {fixtures && a.role !== 'readonly' && (
              <ZettleAction
                key={`${a.id}-${state.lastSync}`}
                command={{
                  action: 'sync',
                  tenantId: a.id,
                  previous: state.cursor,
                }}
                d={d}
                label={d.sync}
              />
            )}
            <h2>{d.catalogTitle}</h2>
            <p>{d.catalogHint}</p>
            <p>
              {d.pendingProducts}: {catalog.candidates.length}
            </p>
            {liveReady && pull?.connection && (
              <section aria-label={d.stockTitle}>
                <h2>{d.stockTitle}</h2>
                <p>{d.stockHint}</p>
                {images !== null && <p>{d.imageHint}</p>}
                {exportItems.map((itemId) => {
                  const stock = stocks.find((s) => s.item_id === itemId)
                  return (
                    <div
                      key={itemId}
                      className="card"
                      data-testid={`zettle-export-${itemId}`}
                    >
                      <Link
                        className="text-link"
                        href={`/intake/items/${itemId}`}
                      >
                        I-{itemId.slice(0, 8).toUpperCase()}
                      </Link>
                      {stock && <p>{d.stockStates[stock.status]}</p>}
                      {(images ?? [])
                        .filter((image) => image.item_id === itemId)
                        .map((image) => (
                          <p key={image.item_id}>
                            {d.imageStates[image.status]}
                          </p>
                        ))}
                      {stock && images !== null && (
                        <ZettleAction
                          command={{
                            action: 'exportImage',
                            tenantId: a.id,
                            itemId,
                          }}
                          d={d}
                          label={d.exportImage}
                        />
                      )}
                      {stock?.status !== 'depleted' && (
                        <ZettleAction
                          key={`${itemId}-${stock?.checked_at ?? 'new'}`}
                          command={{ action: 'export', tenantId: a.id, itemId }}
                          d={d}
                          label={stock ? d.checkStock : d.exportItem}
                        />
                      )}
                    </div>
                  )
                })}
              </section>
            )}
            <details>
              <summary>{d.vatTitle}</summary>
              <p>{d.vatHint}</p>
              <p>{d.vatComparisonHint}</p>
              {['owner', 'admin'].includes(a.role) && (
                <ZettleAction
                  key={catalog.config?.id ?? 'new'}
                  command={{
                    action: 'configure',
                    tenantId: a.id,
                    previousId: catalog.config?.id ?? null,
                    vatMap: catalog.config?.vat_map ?? {},
                  }}
                  d={d}
                  label={d.saveMapping}
                  vatModes={all.sales.vatModes}
                  engineVatBasisPoints={engineVat}
                />
              )}
            </details>
            <details>
              <summary>{d.productStatus}</summary>
              {catalog.outcomes.map((o, i) => (
                <p key={`${o.export_id}-${i}`}>
                  {o.status === 'synced' ? d.synced : d.productFailed}
                  {o.error_code
                    ? `: ${(d.errors as Record<string, string>)[o.error_code] ?? d.failed}`
                    : ''}
                </p>
              ))}
            </details>
            <h2>{d.recent}</h2>
            {!state.imports.length && <p>{d.empty}</p>}
            {state.imports.map((r) => (
              <p key={r.id}>
                <Link
                  className="text-link"
                  href={`/intake/integrations/${r.id}`}
                >
                  {d.open} · {r.external_id}
                </Link>{' '}
                · {formatSignedOre(r.amount_ore)} {r.currency}
                {r.blocked_reason ? ` · ${d.blocked}` : ''}
              </p>
            ))}
            {state.next && (
              <p>
                <Link
                  className="text-link"
                  href={`/intake/integrations?${new URLSearchParams(state.next)}`}
                >
                  {d.older}
                </Link>
              </p>
            )}
            {paging && (
              <p>
                <Link className="text-link" href="/intake/integrations">
                  {d.newest}
                </Link>
              </p>
            )}
          </section>
        </details>
      </section>
      <section
        className="integration-group"
        aria-labelledby="integration-commerce"
      >
        <h2 id="integration-commerce">{all.integrationPage.ecommerce}</h2>
        {['owner', 'admin'].includes(a.role) && (
          <ShopifyConnection
            key={`shopify-${a.id}`}
            tenantId={a.id}
            status={shopifyStatus}
            issue={shopifyIssue(a.id, shopifyEnvironment(process.env))}
            outcome={typeof params.shopify === 'string' ? params.shopify : null}
            expired={shopifyExpired}
            locale={ctx.locale}
            d={all.shopify}
          />
        )}
        {shopifySettings && ['owner', 'admin'].includes(a.role) && (
          <ShopifySetup
            key={a.id + shopifySettings.revision}
            tenantId={a.id}
            status={shopifySettings}
            d={all.shopify}
          />
        )}
        {shopifyStatus.connected &&
          (shopifySettings?.settings || shopifySettings?.locked) && (
            <details className="card integration-details">
              <summary>Shopify · {all.integrationPage.manage}</summary>
              {['owner', 'admin'].includes(a.role) &&
                shopifyCandidates &&
                shopifyProducts && (
                  <ShopifyProducts
                    key={`shopify-products-${a.id}`}
                    tenantId={a.id}
                    candidates={shopifyCandidates}
                    products={shopifyProducts}
                    currency={shopifyStatus.currency ?? 'SEK'}
                    locale={ctx.locale}
                    d={all.shopify}
                  />
                )}
              {['owner', 'admin'].includes(a.role) && shopifyOrders && (
                <ShopifyOrders
                  key={`shopify-orders-${a.id}`}
                  tenantId={a.id}
                  status={shopifyOrders}
                  locale={ctx.locale}
                  d={all.shopify}
                />
              )}
              {['owner', 'admin'].includes(a.role) && shopifyOrders && (
                <section
                  className="card"
                  aria-label={all.shopify.automation.heading}
                >
                  <AutomationSwitch
                    key={`shopify-auto-${a.id}`}
                    tenantId={a.id}
                    scope="shopify_pull"
                    grants={automation}
                    configured={
                      !!automationIdentity() &&
                      shopifyAuto?.available === true &&
                      automation !== null
                    }
                    canEdit={a.role === 'owner'}
                    t={all.shopify.automation}
                  />
                  <p>
                    {all.shopify.automation.lastRun}:{' '}
                    {shopifyAuto?.run
                      ? `${new Date(shopifyAuto.run.at).toLocaleString(ctx.locale, { timeZone: 'Europe/Stockholm' })} · ${all.shopify.automation.outcomes[shopifyAuto.run.outcome]} · ${shopifyAuto.run.received}`
                      : all.shopify.automation.noRun}
                  </p>
                </section>
              )}
            </details>
          )}
      </section>
      <section
        className="integration-group"
        aria-labelledby="integration-accounting"
      >
        <h2 id="integration-accounting">{all.integrationPage.accounting}</h2>
        <FortnoxConnection
          key={`fortnox-${a.id}-${fortnoxStatus.refreshedAt ?? 'none'}`}
          tenantId={a.id}
          status={fortnoxStatus}
          issue={fortnoxIssue(a.id, fortnoxEnvironment(process.env))}
          canConnect={['owner', 'admin'].includes(a.role)}
          outcome={typeof params.fortnox === 'string' ? params.fortnox : null}
          locale={ctx.locale}
          d={all.fortnox}
        />
        <p>
          <Link className="text-link" href="/intake/accounting?view=settings">
            {all.integrationPage.accountingSettings}
          </Link>
        </p>
      </section>
    </>
  )
}
