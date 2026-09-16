import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// P3 surfaces: the settlement batch, the economy overview, the store profile,
// self drop-off and the markdown runs, each proven through the browser
// against the same engine the pgTAP files prove.

test('settlement batch reserves every candidate and the economy page shows the period', async ({
  page,
}) => {
  const email = `p3-settle-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    // Two sold items give the seller 160 SEK of credit, above the 100 SEK minimum.
    const items = [await f.item('P3 sold one'), await f.item('P3 sold two')]
    await f.db.query(
      "select record_sale($1,$2,'manual','P3-1',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify(items.map((itemId) => ({ itemId, priceOre: 20000 }))),
      ],
    )
    await f.commit()
    await page.goto('/intake/payouts')
    const settle = page.locator('section', {
      has: page.getByRole('heading', {
        name: d.payouts.settleHeading,
        exact: true,
      }),
    })
    await expect(settle.getByText(/160\.00 SEK/).first()).toBeVisible()
    await settle
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('September')
    await settle.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    await settle
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '1'),
        exact: true,
      })
      .click()
    await expect(
      page.getByText(d.payouts.settled, { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText(d.payouts.settleEmpty, { exact: true }),
    ).toBeVisible()
    const payout = (
      await f.db.query(
        'select status,amount_ore from payouts where tenant_id=$1 and seller_id=$2',
        [f.tenant, f.seller],
      )
    ).rows
    expect(payout).toEqual([{ status: 'approved', amount_ore: '16000' }])
    expect(
      (
        await f.db.query(
          'select payout_count,reason from payout_batches where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ payout_count: 1, reason: 'September' }])
    await page.goto('/intake/economy')
    const totals = page.getByRole('region', {
      name: d.economy.totalsHeading,
      exact: true,
    })
    await expect(totals.getByText(/400\.00 SEK/).first()).toBeVisible()
    await expect(
      page.getByRole('region', {
        name: d.economy.liabilityHeading,
        exact: true,
      }),
    ).toContainText('160.00 SEK')
  } finally {
    await f.close()
  }
})

test('store profile publishes a version that anyone can read by slug', async ({
  page,
}) => {
  const email = `p3-profile-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    const profile = page.getByRole('region', {
      name: d.storeProfile.title,
      exact: true,
    })
    await expect(
      profile.getByText(d.storeProfile.defaults, { exact: true }),
    ).toBeVisible()
    await profile.getByLabel(d.storeProfile.city, { exact: true }).fill('Oslo')
    await profile
      .getByLabel(d.storeProfile.country, { exact: true })
      .selectOption('NO')
    await profile
      .getByLabel(d.storeProfile.concept, { exact: true })
      .fill('Synthetic concept text')
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/intake') &&
        response.request().method() === 'POST',
    )
    await profile
      .getByRole('button', { name: d.storeProfile.publish, exact: true })
      .click()
    expect((await published).ok()).toBe(true)
    await page.reload()
    await expect(
      page
        .getByRole('region', { name: d.storeProfile.title, exact: true })
        .getByText(`${d.storeProfile.version} 1`, { exact: true }),
    ).toBeVisible()
    const slug = (
      await f.db.query('select slug from tenants where id=$1', [f.tenant])
    ).rows[0].slug
    // The anonymous read: no session, only the published document.
    await f.db.query('begin')
    await f.db.query('set local role anon')
    const pub = (await f.db.query('select public_store_profile($1) p', [slug]))
      .rows[0].p
    await f.db.query('commit')
    expect(pub.version).toBe(1)
    expect(pub.profile.address.city).toBe('Oslo')
    expect(pub.profile.address.country).toBe('NO')
    await expect(
      profile.getByLabel(d.storeProfile.country, { exact: true }),
    ).toHaveValue('NO')
    expect(pub.profile.concept).toBe('Synthetic concept text')
    expect(Object.keys(pub).sort()).toEqual([
      'name',
      'profile',
      'publishedAt',
      'slug',
      'version',
    ])
  } finally {
    await f.close()
  }
})

test('a seller announces a handover and staff receive it as a bag', async ({
  page,
}) => {
  const email = `p3-handover-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    // The same verified person is also a seller of this store, so the portal
    // opens for them; the store allows announced drop-offs.
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Portal seller',
        email,
        '',
      ])
    ).rows[0].id
    const current = (
      await f.db.query(
        'select id,policy from store_policy_versions where tenant_id=$1 order by version desc limit 1',
        [f.tenant],
      )
    ).rows[0]
    await f.db.query('select publish_store_policy($1,$2,$3,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      current.id,
      JSON.stringify({
        ...current.policy,
        custodySources: ['staff_receipt', 'seller_dropoff'],
      }),
    ])
    await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      seller,
      f.agreement,
      'Synthetic paper agreement',
    ])
    await f.commit()
    await page.goto(`/seller?seller=${seller}`)
    const portal = page.getByRole('region', {
      name: d.sellerPortal.handovers,
      exact: true,
    })
    await portal
      .getByLabel(d.sellerPortal.estimatedItems, { exact: true })
      .fill('7')
    await portal
      .getByLabel(d.sellerPortal.handoverNote, { exact: true })
      .fill('Synthetic winter coats')
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(portal.getByText(/^H-\d+$/)).toBeVisible()
    const reference = await portal.getByText(/^H-\d+$/).textContent()
    await page.goto(`/intake/open?ref=${reference}`)
    await expect(page).toHaveURL(/\/intake\/handovers\?focus=/)
    await page.getByLabel(d.handovers.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(
      page.getByText(
        new RegExp(`${reference} .*${d.handovers.statuses.received}`),
      ),
    ).toBeVisible()
    const handover = (
      await f.db.query(
        'select h.status,h.custody_source,b.seller_id from seller_handovers h join bag_receipts b on b.id=h.received_bag_id where h.tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(handover).toEqual([
      {
        status: 'received',
        custody_source: 'staff_receipt',
        seller_id: seller,
      },
    ])
    await page.goto(`/seller?seller=${seller}`)
    await expect(
      page
        .getByRole('region', { name: d.sellerPortal.handovers, exact: true })
        .getByText(/K-\d+/),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('markdown runs apply every due step by hand and the policy switch turns the agent on', async ({
  page,
}) => {
  const email = `p3-markdown-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const items = [await f.item('P3 due one'), await f.item('P3 due two')]
    await f.commit()
    await page.goto('/intake/lifecycle')
    const runs = page.getByRole('region', {
      name: d.lifecycle.agentHeading,
      exact: true,
    })
    await expect(
      runs.getByText(d.lifecycle.agentOff, { exact: true }),
    ).toBeVisible()
    await runs
      .getByRole('button', {
        name: d.lifecycle.applyAllDue.replace('{count}', '2'),
        exact: true,
      })
      .click()
    await expect(
      runs.getByText(`1 ${d.lifecycle.modes.manual}`.replace('1 ', ''), {
        exact: false,
      }),
    ).toBeVisible()
    await expect(runs).toContainText(`2 ${d.lifecycle.applied}`)
    for (const item of items)
      expect(
        Number(
          (
            await f.db.query(
              'select price_ore from item_prices where item_id=$1 order by seq desc limit 1',
              [item],
            )
          ).rows[0].price_ore,
        ),
      ).toBe(18000)
    await page.goto('/settings')
    await page
      .getByLabel(d.storePolicy.automaticMarkdowns, { exact: true })
      .check()
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(
      page.getByLabel(d.storePolicy.automaticMarkdowns, { exact: true }),
    ).toBeChecked()
    await page.goto('/intake/lifecycle')
    await expect(
      page
        .getByRole('region', { name: d.lifecycle.agentHeading, exact: true })
        .getByText(d.lifecycle.agentOn, { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
