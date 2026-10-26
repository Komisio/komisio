import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('day collection grace is saved, frozen on new items and shown to the seller', async ({
  page,
}, testInfo) => {
  const email = `collection-grace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings#policy-section-period')
    const grace = page.getByLabel(d.storePolicy.collectionDays, { exact: true })
    await expect(grace).toBeVisible()
    await expect(grace).toHaveValue('')
    await grace.fill('7')
    await page
      .getByLabel(d.storePolicy.endOfPeriodAction, { exact: true })
      .selectOption('return')
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(
      page.getByText(d.storePolicy.saved, { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(grace).toHaveValue('7')
    const item = await f.asActor(f.actor, async () =>
      f.item('Synthetic collection coat'),
    )
    const terms = (
      await f.db.query('select terms from items where id=$1', [item])
    ).rows[0].terms
    expect(terms.collectionDays).toBe(7)
    expect(terms.consignmentPeriod).toBeUndefined()
    await page.goto(`/intake/items/${item}`)
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic collection coat',
        exact: true,
      }),
    ).toBeVisible()
    // The test owner also represents a separate synthetic seller to exercise the
    // scoped portal projection without bypassing the verified-email boundary.
    const seller = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
            f.tenant,
            randomUUID(),
            'Synthetic portal seller',
            email,
            '',
          ])
        ).rows[0].id,
    )
    await page.goto(
      `/seller?tenant=${f.tenant}&seller=${seller}#seller-workspace-agreement`,
    )
    await expect(
      page.getByText(
        d.sellerAgreementSummary.collection.replace('{days}', '7'),
        { exact: true },
      ),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('day-grace-seller.png'),
      fullPage: true,
    })
    await page.goto('/settings#policy-section-period')
    await page
      .getByLabel(d.storePolicy.consignmentCalendarEnabled, { exact: true })
      .check()
    await expect(
      page.getByLabel(d.storePolicy.collectionDays, { exact: true }),
    ).toHaveValue('2')
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(
      page.getByText(d.storePolicy.saved, { exact: true }),
    ).toBeVisible()
    const policy = (
      await f.db.query(
        'select policy from store_policy_versions where tenant_id=$1 order by version desc limit 1',
        [f.tenant],
      )
    ).rows[0].policy
    expect(policy.collectionDays).toBeUndefined()
    expect(policy.consignmentPeriod.collectionDays).toBe(2)
    expect(
      (await f.db.query('select terms from items where id=$1', [item])).rows[0]
        .terms.collectionDays,
    ).toBe(7)
  } finally {
    await f.close()
    await page.goto('about:blank')
  }
})
