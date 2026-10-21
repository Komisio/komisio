import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { EventTime } from '@/components/ui/event-time'
import { SyncPreferences } from '@/components/intake/sync-preferences'
import { CatalogAutomationSettings } from '@/components/intake/catalog-automation'
import { readCatalogAutomation } from '@/lib/engine/catalog-automation'
import { readSyncPreferences } from '@/lib/engine/sync-preferences'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { FortnoxConnection } from '@/components/intake/fortnox-connection'
import { readEconomicStatus } from '@/lib/engine/economic'
import { FortnoxGuide } from '@/components/help/fortnox-guide'
import {
  readPayPalStatus,
  paypalAppAvailable,
} from '@/lib/engine/paypal-credentials'
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
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { ZettleConnection } from '@/components/intake/zettle-connection'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
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
    paypal = ['owner', 'admin'].includes(a.role)
      ? await readPayPalStatus(ctx.client, a.id)
      : null,
    liveReady = !!paypal?.connected && !paypal.reconnectRequired
  const stocks = ['owner', 'admin'].includes(a.role)
    ? await readZettleStock(ctx.client, a.id)
    : []
  const engineVat = ['owner', 'admin'].includes(a.role)
    ? vatRateBasisPoints((await readStorePolicy(ctx.client, a.id)).policy)
    : undefined

  const syncPreferences = ['owner', 'admin'].includes(a.role)
    ? await readSyncPreferences(ctx.client, a.id)
    : null
  const catalogAutomation = ['owner', 'admin'].includes(a.role)
    ? await readCatalogAutomation(ctx.client, a.id, 'paypal')
    : null
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
  const economicStatus = await readEconomicStatus(ctx.client, a.id)
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
  const p = all.integrationPage.paypalWorkspace
  const admin = ['owner', 'admin'].includes(a.role)
  return (
    <div className="integrations-page">
      <div className="page-heading">
        <h1>{all.nav.integrations}</h1>
        <p>{all.integrationPage.intro}</p>
      </div>
      {!['owner', 'admin'].includes(a.role) && (
        <p>{all.integrationPage.adminOnly}</p>
      )}
      <div className="integration-catalog">
        <details
          className="card integration-provider paypal-provider"
          data-testid="integration-paypal"
          open={
            Boolean(paging) ||
            params.provider === 'paypal' ||
            typeof params.paypal === 'string'
          }
        >
          <summary>
            <span className="integration-provider-copy">
              <strong>PayPal POS</strong>
              <span>{all.integrationPage.paypalPurpose}</span>
            </span>
            {admin && (
              <span
                className={`pos-status ${liveReady ? 'pos-status-on' : paypal?.reconnectRequired ? 'pos-status-warning' : ''}`}
              >
                {liveReady
                  ? p.connected
                  : paypal?.reconnectRequired
                    ? p.reconnect
                    : p.disconnected}
              </span>
            )}
          </summary>
          <div className="pos-workspace">
            <WorkspaceTabs
              id="paypal"
              label="PayPal POS"
              initial={
                paging
                  ? 'sales'
                  : params.paypal || (!liveReady && admin)
                    ? 'settings'
                    : 'sales'
              }
              tabs={[
                {
                  id: 'sales',
                  label: p.sales,
                  content: (
                    <>
                      <div className="pos-section-heading">
                        <div>
                          <h2>{p.sales}</h2>
                          <p className="muted">
                            {p.lastPull}:{' '}
                            {state.lastSync ? (
                              <EventTime
                                value={state.lastSync}
                                locale={ctx.locale}
                              />
                            ) : (
                              p.never
                            )}
                          </p>
                        </div>
                        {liveReady &&
                          pull &&
                          (pull.connection ? (
                            <ZettleAction
                              compact
                              key={
                                closure?.closure?.id ??
                                pull.page?.id ??
                                pull.window?.id ??
                                'pull'
                              }
                              command={{ action: 'pull', tenantId: a.id }}
                              d={d}
                              label={p.pull}
                            />
                          ) : (
                            <ZettleAction
                              compact
                              command={{ action: 'enablePull', tenantId: a.id }}
                              d={d}
                              label={d.pullEnable}
                            />
                          ))}
                      </div>
                      {!liveReady && admin && !fixtures && (
                        <Link className="text-link" href="#paypal-settings">
                          {p.start}
                        </Link>
                      )}
                      {liveReady && pull?.connection && (
                        <>
                          {automation !== null &&
                            automaticStatus?.available && (
                              <div className="pos-automation">
                                <h3>{p.automatic}</h3>
                                <small>{p.interval}</small>
                                <p
                                  className={`pos-status ${automaticGrant?.accepted ? 'pos-status-on' : ''}`}
                                >
                                  {automaticGrant
                                    ? automaticGrant.accepted
                                      ? d.automaticEnabled
                                      : d.automaticPending
                                    : d.automaticDisabled}
                                </p>
                                {automaticStatus.run && (
                                  <p>
                                    {new Date(
                                      automaticStatus.run.at,
                                    ).toLocaleString(intlLocale(ctx.locale), {
                                      timeZone: 'Europe/Stockholm',
                                    })}
                                    {' · '}
                                    {
                                      d.automaticOutcomes[
                                        automaticStatus.run.outcome
                                      ]
                                    }
                                    {' · '}
                                    {automaticStatus.run.received}
                                  </p>
                                )}
                                {a.role === 'owner' &&
                                  (automaticGrant || automationIdentity()) && (
                                    <ZettleAction
                                      compact
                                      secondary
                                      key={
                                        automaticGrant?.id ?? 'automatic-off'
                                      }
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

                          <details className="pos-details">
                            <summary>{p.details}</summary>
                            <p>
                              {d.pullSince}:{' '}
                              <EventTime
                                value={pull.connection.cutover}
                                locale={ctx.locale}
                              />
                            </p>
                            <p>{d.pullHint}</p>
                            {pull.window && (
                              <p>
                                {closure?.closure
                                  ? d.abandoned
                                  : pull.page?.purchase_count === 0
                                    ? d.pullComplete
                                    : d.pullPending}
                                :{' '}
                                {new Date(pull.window.end_at).toLocaleString(
                                  intlLocale(ctx.locale),
                                  {
                                    timeZone: 'Europe/Stockholm',
                                  },
                                )}
                              </p>
                            )}

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
                          </details>
                        </>
                      )}
                      {fixtures && (
                        <div className="pos-fixture">
                          <p>{d.fixture}</p>
                          {a.role !== 'readonly' && (
                            <ZettleAction
                              compact
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
                        </div>
                      )}
                      <h3>{d.recent}</h3>
                      {!state.imports.length ? (
                        <p className="pos-empty">{d.empty}</p>
                      ) : (
                        <div
                          className="inventory-table-scroll"
                          tabIndex={0}
                          role="region"
                          aria-label={d.recent}
                        >
                          <table className="inventory-table pos-receipts">
                            <thead>
                              <tr>
                                <th scope="col">{p.received}</th>
                                <th scope="col">{all.items.stage}</th>
                                <th scope="col" className="inventory-number">
                                  {all.sales.total}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {state.imports.map((r) => (
                                <tr key={r.id}>
                                  <th scope="row">
                                    <Link
                                      className="pos-receipt-link"
                                      href={`/intake/integrations/${r.id}`}
                                      aria-label={`${d.open} · ${r.external_id}`}
                                    >
                                      <EventTime
                                        value={r.created_at}
                                        locale={ctx.locale}
                                      />
                                    </Link>
                                  </th>
                                  <td>
                                    <span
                                      className={`pos-status ${r.blocked_reason ? 'pos-status-warning' : ''}`}
                                    >
                                      {r.returned
                                        ? d.returns.recorded
                                        : r.blocked_reason
                                          ? p.attention
                                          : p.received}
                                    </span>
                                  </td>
                                  <td className="inventory-number">
                                    {formatSignedOre(r.amount_ore)} {r.currency}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <nav className="pos-actions" aria-label={d.recent}>
                        {state.next && (
                          <Link
                            className="btn btn-secondary"
                            href={`/intake/integrations?provider=paypal&${new URLSearchParams(state.next)}#paypal-sales`}
                          >
                            {d.older}
                          </Link>
                        )}
                        {paging && (
                          <Link
                            className="btn btn-secondary"
                            href="/intake/integrations?provider=paypal#paypal-sales"
                          >
                            {d.newest}
                          </Link>
                        )}
                      </nav>
                    </>
                  ),
                },
                {
                  id: 'products',
                  label: p.products,
                  content: (
                    <>
                      <div className="pos-section-heading">
                        <h2>{p.products}</h2>
                        <Link
                          className="btn btn-secondary"
                          href="/intake/items?syncProvider=paypal&sort=title&direction=asc"
                        >
                          {d.itemSync.allItems}
                        </Link>
                      </div>
                      {catalogAutomation && (
                        <CatalogAutomationSettings
                          compact
                          tenantId={a.id}
                          initial={catalogAutomation}
                          configured={!!automationIdentity()}
                          canEdit={a.role === 'owner'}
                          d={all}
                        />
                      )}
                      <p className="muted">
                        {d.pendingProducts}: {catalog.candidates.length}
                      </p>
                      {liveReady && pull?.connection && (
                        <section
                          className="pos-products"
                          aria-label={d.stockTitle}
                        >
                          {!exportItems.length && (
                            <p className="pos-empty">{p.noItems}</p>
                          )}
                          {exportItems.map((itemId) => {
                            const stock = stocks.find(
                              (s) => s.item_id === itemId,
                            )
                            return (
                              <div
                                className="pos-product-row"
                                key={itemId}
                                data-testid={`zettle-export-${itemId}`}
                              >
                                <Link
                                  className="text-link"
                                  href={`/intake/items/${itemId}`}
                                >
                                  I-{itemId.slice(0, 8).toUpperCase()}
                                </Link>
                                {stock && (
                                  <span
                                    className={`pos-status ${stock.status === 'initialized' ? 'pos-status-on' : stock.status === 'depleted' ? '' : 'pos-status-warning'}`}
                                    title={d.stockStates[stock.status]}
                                  >
                                    {all.itemSync.stockStates[stock.status]}
                                  </span>
                                )}
                                {(images ?? [])
                                  .filter((image) => image.item_id === itemId)
                                  .map((image) => (
                                    <span
                                      className={`pos-status ${image.status === 'synced' ? 'pos-status-on' : 'pos-status-warning'}`}
                                      title={d.imageStates[image.status]}
                                      key={image.item_id}
                                    >
                                      {p.images}:{' '}
                                      {all.itemSync.imageStates[image.status]}
                                    </span>
                                  ))}
                                {stock && images !== null && (
                                  <ZettleAction
                                    compact
                                    secondary
                                    command={{
                                      action: 'exportImage',
                                      tenantId: a.id,
                                      itemId,
                                    }}
                                    d={d}
                                    label={p.syncImage}
                                  />
                                )}
                                {stock?.status !== 'depleted' && (
                                  <ZettleAction
                                    compact
                                    secondary
                                    key={`${itemId}-${stock?.checked_at ?? 'new'}`}
                                    command={{
                                      action: 'export',
                                      tenantId: a.id,
                                      itemId,
                                    }}
                                    d={d}
                                    label={p.syncItem}
                                  />
                                )}
                              </div>
                            )
                          })}
                        </section>
                      )}
                      {a.role === 'staff' &&
                        images !== null &&
                        images.length > 0 && (
                          <section aria-label={d.imageStatusTitle}>
                            {images.map((image) => (
                              <div
                                className="pos-product-row"
                                key={image.item_id}
                              >
                                <Link
                                  className="text-link"
                                  href={`/intake/items/${image.item_id}`}
                                >
                                  I-{image.item_id.slice(0, 8).toUpperCase()}
                                </Link>
                                <span className="pos-status">
                                  {d.imageStates[image.status]}
                                </span>
                              </div>
                            ))}
                          </section>
                        )}
                      <details className="pos-details">
                        <summary>{d.productStatus}</summary>
                        {catalog.outcomes.map((o, i) => (
                          <p key={`${o.export_id}-${i}`}>
                            <span
                              className={`pos-status ${o.status === 'synced' ? 'pos-status-on' : 'pos-status-warning'}`}
                            >
                              {o.status === 'synced'
                                ? d.synced
                                : d.productFailed}
                            </span>{' '}
                            <EventTime
                              value={o.created_at}
                              locale={ctx.locale}
                            />
                            {o.error_code
                              ? `: ${(d.errors as Record<string, string>)[o.error_code] ?? d.failed}`
                              : ''}
                          </p>
                        ))}
                      </details>
                    </>
                  ),
                },
                {
                  id: 'settings',
                  label: p.settings,
                  content: (
                    <>
                      {admin && (
                        <section className="pos-settings-section">
                          <h2>{p.connection}</h2>
                          <ZettleConnection
                            compact
                            checkLabel={p.check}
                            key={a.id}
                            tenantId={a.id}
                            connected={!!paypal?.connected}
                            reconnectRequired={!!paypal?.reconnectRequired}
                            result={
                              typeof params.paypal === 'string'
                                ? params.paypal
                                : undefined
                            }
                            setupAvailable={paypalAppAvailable(process.env)}
                            d={d}
                          />
                        </section>
                      )}
                      {syncPreferences
                        ?.filter((pref) => pref.provider === 'paypal')
                        .map((pref) => (
                          <section
                            className="pos-settings-section"
                            key={pref.connectionId}
                          >
                            <h2>{p.images}</h2>
                            <SyncPreferences
                              compact
                              tenantId={a.id}
                              initial={pref}
                              d={all}
                            />
                          </section>
                        ))}
                      <details className="pos-details">
                        <summary>{p.vat}</summary>
                        <p>{d.vatHint}</p>
                        <p>{d.vatComparisonHint}</p>
                        {['owner', 'admin'].includes(a.role) && (
                          <ZettleAction
                            compact
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
                    </>
                  ),
                },
              ]}
            />
          </div>
        </details>
        <details
          className="card integration-provider"
          data-testid="integration-shopify"
          open={
            typeof params.shopify === 'string' || params.provider === 'shopify'
          }
        >
          <summary>
            <span className="integration-provider-copy">
              <strong>Shopify</strong>
              <span>{all.integrationPage.shopifyPurpose}</span>
            </span>
            <span className="integration-status">
              {shopifyExpired
                ? all.integrationPage.reconnect
                : shopifyStatus.connected
                  ? all.integrationPage.connectionSaved
                  : all.integrationPage.notConnected}
            </span>
            <span className="integration-provider-toggle">
              {all.integrationPage.setupAction}
            </span>
          </summary>
          <section
            className="integration-group"
            aria-labelledby="integration-commerce"
          >
            <h2 id="integration-commerce">{all.integrationPage.ecommerce}</h2>
            {['owner', 'admin'].includes(a.role) && (
              <Link className="text-link" href="/intake/integrations/privacy">
                {all.shopifyPrivacy.title}
              </Link>
            )}

            {['owner', 'admin'].includes(a.role) && (
              <ShopifyConnection
                key={`shopify-${a.id}`}
                tenantId={a.id}
                status={shopifyStatus}
                issue={shopifyIssue(a.id, shopifyEnvironment(process.env))}
                outcome={
                  typeof params.shopify === 'string' ? params.shopify : null
                }
                expired={shopifyExpired}
                locale={ctx.locale}
                d={all.shopify}
              />
            )}
            {syncPreferences
              ?.filter((p) => p.provider === 'shopify')
              .map((p) => (
                <SyncPreferences
                  key={p.connectionId}
                  tenantId={a.id}
                  initial={p}
                  d={all}
                />
              ))}
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
                          ? `${new Date(shopifyAuto.run.at).toLocaleString(intlLocale(ctx.locale), { timeZone: 'Europe/Stockholm' })} · ${all.shopify.automation.outcomes[shopifyAuto.run.outcome]} · ${shopifyAuto.run.received}`
                          : all.shopify.automation.noRun}
                      </p>
                    </section>
                  )}
                </details>
              )}
          </section>
        </details>
        <details
          className="card integration-provider"
          data-testid="integration-fortnox"
          open={
            typeof params.fortnox === 'string' || params.provider === 'fortnox'
          }
        >
          <summary>
            <span className="integration-provider-copy">
              <strong>Fortnox</strong>
              <span>{all.integrationPage.fortnoxPurpose}</span>
            </span>
            <span className="integration-status">
              {fortnoxStatus.connected
                ? all.integrationPage.connectionSaved
                : all.integrationPage.notConnected}
            </span>
            <span className="integration-provider-toggle">
              {all.integrationPage.setupAction}
            </span>
          </summary>
          <section
            className="integration-group"
            aria-labelledby="integration-accounting"
          >
            <h2 id="integration-accounting">
              {all.integrationPage.accounting}
            </h2>
            <FortnoxConnection
              key={`fortnox-${a.id}-${fortnoxStatus.refreshedAt ?? 'none'}`}
              tenantId={a.id}
              status={fortnoxStatus}
              issue={fortnoxIssue(a.id, fortnoxEnvironment(process.env))}
              canConnect={['owner', 'admin'].includes(a.role)}
              outcome={
                typeof params.fortnox === 'string' ? params.fortnox : null
              }
              locale={ctx.locale}
              d={all.fortnox}
            />
            <FortnoxGuide
              client={ctx.client}
              tenantId={a.id}
              role={a.role}
              connection={fortnoxStatus}
              ready={
                fortnoxIssue(a.id, fortnoxEnvironment(process.env)) === null &&
                credentialKeyConfigured(process.env)
              }
              d={all.helpCenter}
            />
            <p>
              <Link
                className="text-link"
                href="/intake/accounting?view=settings"
              >
                {all.integrationPage.accountingSettings}
              </Link>
            </p>
          </section>
        </details>
        <details
          className="card integration-provider"
          data-testid="integration-economic"
          open={params.provider === 'economic'}
        >
          <summary>
            <span className="integration-provider-copy">
              <strong>e-conomic</strong>
              <span>{all.economic.intro}</span>
            </span>
            <span className="integration-status">
              {economicStatus?.connected
                ? all.integrationPage.connectionSaved
                : all.integrationPage.notConnected}
            </span>
            <span className="integration-provider-toggle">
              {all.integrationPage.setupAction}
            </span>
          </summary>
          <section
            className="integration-group"
            aria-labelledby="integration-economic-heading"
          >
            <h2 id="integration-economic-heading">e-conomic</h2>
            <Link
              className="text-link"
              href="/intake/accounting?view=settings#economic-connection"
            >
              {all.integrationPage.accountingSettings}
            </Link>
          </section>
        </details>
      </div>
      <p className="integration-status-note">
        {all.integrationPage.statusHint}
      </p>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.nav.integrations)
