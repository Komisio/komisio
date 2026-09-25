import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('an old handover label opens only its exact active-store receipt', async ({
  page,
}) => {
  const email = `handover-exact-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic portal seller',
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
    const id = randomUUID()
    await f.db.query(
      "select create_my_handover($1,$2,$3,'box',2,'Old synthetic furniture')",
      [f.tenant, id, seller],
    )
    const reference =
      'H-' +
      (
        await f.db.query('select reference from seller_handovers where id=$1', [
          id,
        ])
      ).rows[0].reference
    await f.commit()
    await f.asActor(f.actor, async () => {
      for (let n = 0; n < 102; n++)
        await f.db.query("select create_my_handover($1,$2,$3,'bag',1,$4)", [
          f.tenant,
          randomUUID(),
          seller,
          `Recent synthetic notice ${n}`,
        ])
      const recent = (
        await f.db.query('select handover_queue($1) rows', [f.tenant])
      ).rows[0].rows as Array<{ id: string }>
      expect(recent).toHaveLength(100)
      expect(recent.some((row) => row.id === id)).toBe(false)
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/open?ref=${reference}`)
    await expect(page).toHaveURL(new RegExp('focus=' + id + '$'))
    const receipt = page.locator('#handover-' + id)
    await expect(receipt).toBeFocused()
    await expect(receipt).toBeInViewport()
    await expect(receipt).toContainText('Old synthetic furniture')
    await expect(page.getByText(/Recent synthetic notice/)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.handovers.receive, exact: true }),
    ).toHaveCount(1)
    await page.screenshot({
      path: test.info().outputPath('old-handover-mobile.png'),
      caret: 'initial',
    })
    await receipt.getByLabel(d.handovers.confirm, { exact: true }).check()
    await receipt
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(receipt).toContainText(d.handovers.statuses.received)
    expect(
      (
        await f.db.query(
          'select seller_id,status from seller_handovers where id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ seller_id: seller, status: 'received' })
    await page
      .getByRole('link', { name: d.handovers.backToQueue, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/handovers$/)
    await expect(page.locator('[id^="handover-"]')).toHaveCount(100)
    for (const focus of [randomUUID(), 'invalid']) {
      await page.goto('/intake/handovers?focus=' + focus)
      await expect(
        page.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: d.handovers.receive, exact: true }),
      ).toHaveCount(0)
    }
    await f.asActor(f.actor, async () => {
      const other = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Other synthetic store',
          'other-' + randomUUID(),
          randomUUID(),
        ])
      ).rows[0].id
      await f.db.query('select set_active_tenant($1)', [other])
    })
    await page.goto('/intake/handovers?focus=' + id)
    await expect(
      page.getByRole('heading', { name: d.notFound, exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Old synthetic furniture')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
