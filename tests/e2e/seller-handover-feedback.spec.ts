import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('handover feedback preserves a lost-response retry and focuses its receipt', async ({
  page,
}) => {
  const email = `handover-feedback-${randomUUID()}@example.test`
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
    for (let n = 0; n < 6; n++)
      await f.db.query("select create_my_handover($1,$2,$3,'bag',1,$4)", [
        f.tenant,
        randomUUID(),
        seller,
        `Older synthetic notice ${n}`,
      ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/seller?seller=${seller}`)
    const portal = page.getByRole('region', {
      name: d.sellerPortal.handovers,
      exact: true,
    })
    const note = portal.getByLabel(d.sellerPortal.handoverNote, { exact: true })
    const number = portal.getByLabel(d.sellerPortal.estimatedItems, {
      exact: true,
    })
    const requests: string[] = []
    await page.route('**/api/seller/handovers', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action === 'createHandover') {
        requests.push(String(payload.requestId))
        if (requests.length === 1) {
          const response = await route.fetch()
          expect(response.ok()).toBe(true)
          // The engine saved successfully, but the response was lost to the caller.
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'REQUEST_FAILED' }),
          })
          return
        }
      }
      await route.continue()
    })
    await note.fill('Synthetic furniture and lamps')
    await number.fill('7')
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(portal.getByRole('alert')).toHaveText(
      d.sellerPortal.handoverError,
    )
    await expect(portal.getByRole('alert')).toBeFocused()
    await expect(portal.getByRole('alert')).toBeInViewport()
    await expect(note).toHaveValue('Synthetic furniture and lamps')
    await expect(number).toHaveValue('7')
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[0]).toBe(requests[1])
    const receipt = page.locator('#seller-handover-' + requests[0])
    await expect(receipt).toBeFocused()
    await expect(receipt).toBeInViewport()
    await expect(receipt).toContainText('Synthetic furniture and lamps')
    await expect(receipt).toContainText(d.sellerPortal.handoverStatuses.open)
    await expect(portal.getByRole('status')).toHaveText(d.sellerPortal.saved)
    await expect(note).toHaveValue('')
    await expect(number).toHaveValue('5')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_handovers where tenant_id=$1 and seller_id=$2',
          [f.tenant, seller],
        )
      ).rows[0].n,
    ).toBe(7)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('handover-receipt-mobile.png'),
      caret: 'initial',
    })
    await note.fill('Unsaved next notice')
    await receipt
      .getByRole('button', { name: d.sellerPortal.cancelHandover, exact: true })
      .click()
    await expect(receipt).toContainText(
      d.sellerPortal.handoverStatuses.cancelled,
    )
    await expect(receipt).toBeFocused()
    await expect(note).toHaveValue('Unsaved next notice')
    expect(
      (
        await f.db.query('select status from seller_handovers where id=$1', [
          requests[0],
        ])
      ).rows[0].status,
    ).toBe('cancelled')
  } finally {
    await f.close()
  }
})
