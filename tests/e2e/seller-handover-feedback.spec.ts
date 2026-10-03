import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function portalFixture(page: Page) {
  const email = `handover-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const seller = (
    await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
      f.tenant,
      randomUUID(),
      'Synthetic recovery seller',
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
  return { f, seller }
}

test('handover creation distinguishes correctable, unconfirmed and stale responses', async ({
  page,
}) => {
  const { f, seller } = await portalFixture(page)
  try {
    await f.commit()
    await page.goto(`/seller?seller=${seller}`)
    const portal = page.getByRole('region', {
      name: d.sellerPortal.handovers,
      exact: true,
    })
    const note = portal.getByLabel(d.sellerPortal.handoverNote, { exact: true })
    const payloads: { requestId: string; note: string }[] = []
    await page.route('**/api/seller/handovers', async (route) => {
      const payload = route.request().postDataJSON()
      payloads.push(payload)
      if (payloads.length === 1) {
        await route.fulfill({ status: 400, json: { error: 'INVALID_INPUT' } })
      } else if (payloads.length === 2) {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.fulfill({
          status: 200,
          json: { ok: true, id: randomUUID() },
        })
      } else if (payloads.length === 3) {
        await route.continue()
      } else {
        await route.fulfill({
          status: 409,
          json: { error: 'HANDOVER_NOT_ENABLED' },
        })
      }
    })
    await note.fill('First synthetic draft')
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(portal.getByRole('alert')).toHaveText(d.intake.invalid)
    await expect(note).toBeEnabled()
    await note.fill('Corrected synthetic draft')
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(note).toBeDisabled()
    await expect(portal.getByRole('status')).toHaveCount(0)
    await portal
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    const receipt = page.locator('#seller-handover-' + payloads[1].requestId)
    await expect(receipt).toBeFocused()
    expect(payloads[0].requestId).not.toBe(payloads[1].requestId)
    expect(payloads[1]).toEqual(payloads[2])
    await expect(portal.getByRole('status')).toHaveText(d.sellerPortal.saved)
    await note.fill('Next synthetic draft')
    await expect(portal.getByRole('status')).toHaveCount(0)
    await portal
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(
      portal.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    await expect(
      portal.getByRole('button', {
        name: d.sellerPortal.announce,
        exact: true,
      }),
    ).toBeDisabled()
    await expect(note).toHaveValue('Next synthetic draft')
    await expect(note).toBeDisabled()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_handovers where tenant_id=$1 and seller_id=$2',
          [f.tenant, seller],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(payloads).toHaveLength(4)
  } finally {
    await f.close()
  }
})

test('two unconfirmed cancellations retain independent retry identities', async ({
  page,
}) => {
  const { f, seller } = await portalFixture(page)
  try {
    const ids = [randomUUID(), randomUUID()]
    for (const id of ids)
      await f.db.query("select create_my_handover($1,$2,$3,'bag',1,$4)", [
        f.tenant,
        id,
        seller,
        'Synthetic cancellation',
      ])
    await f.commit()
    await page.goto(`/seller?seller=${seller}`)
    const payloads = new Map<string, unknown[]>()
    await page.route('**/api/seller/handovers', async (route) => {
      const payload = route.request().postDataJSON()
      const history = payloads.get(payload.handoverId) ?? []
      history.push(payload)
      payloads.set(payload.handoverId, history)
      if (history.length === 1) {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      } else await route.continue()
    })
    for (const id of ids) {
      const card = page.locator('#seller-handover-' + id)
      await card
        .getByRole('button', {
          name: d.sellerPortal.cancelHandover,
          exact: true,
        })
        .click()
      await expect(card.getByRole('alert')).toBeFocused()
    }
    for (const id of ids) {
      const card = page.locator('#seller-handover-' + id)
      await card
        .getByRole('button', { name: new RegExp('^' + d.intake.retry + ':') })
        .click()
      await expect(card).toContainText(
        d.sellerPortal.handoverStatuses.cancelled,
      )
      await expect(card.getByRole('alert')).toHaveCount(0)
      const history = payloads.get(id)!
      expect(history).toHaveLength(2)
      expect(history[0]).toEqual(history[1])
      expect(
        (
          await f.db.query(
            "select count(*)::int n from handover_events where handover_id=$1 and kind='cancelled'",
            [id],
          )
        ).rows[0].n,
      ).toBe(1)
    }
  } finally {
    await f.close()
  }
})

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
    const payloads: unknown[] = []
    await page.route('**/api/seller/handovers', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action === 'createHandover') {
        requests.push(String(payload.requestId))
        payloads.push(payload)
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
    await expect(note).toBeDisabled()
    await expect(number).toBeDisabled()
    await expect(portal.locator('#handover-kind')).toBeDisabled()
    // A separate cancellation must not forget the uncertain creation request.
    const older = portal.locator('.intake-notice').filter({
      hasText: 'Older synthetic notice 0',
    })
    await older
      .getByRole('button', { name: d.sellerPortal.cancelHandover, exact: true })
      .click()
    await expect(older).toContainText(d.sellerPortal.handoverStatuses.cancelled)
    await expect(note).toHaveValue('Synthetic furniture and lamps')
    await expect(number).toHaveValue('7')
    await portal
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[0]).toBe(requests[1])
    expect(payloads[0]).toEqual(payloads[1])
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
