import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('directory registration and duplicate selection stay in the seller workspace', async ({
  page,
}) => {
  const email = `seller-directory-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let registration: Record<string, unknown> | null = null
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/intake')) {
      const body = request.postDataJSON()
      if (body.action === 'registerSeller') registration = body
    }
  })
  try {
    const existing = (
      await f.db.query('select email from sellers where id=$1', [f.seller])
    ).rows[0].email
    await f.commit()
    await page.goto('/intake/sellers')
    await page
      .getByRole('link', { name: d.sellersList.register, exact: true })
      .click()
    await expect(page).toHaveURL('/intake/sellers/new')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic directory seller')
    await page.getByLabel(d.intake.email, { exact: true }).fill(existing)
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    const duplicate = page
      .getByRole('alert')
      .getByRole('link', { name: 'Synthetic P2 seller', exact: true })
    await expect(duplicate).toHaveAttribute(
      'href',
      `/intake/sellers/${f.seller}`,
    )
    await duplicate.click()
    await expect(page).toHaveURL(`/intake/sellers/${f.seller}`)
    await page.goto('/intake/sellers/new')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic new directory seller')
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill(`new-${randomUUID()}@example.test`)
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/sellers\/[0-9a-f-]{36}$/)
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic new directory seller',
        exact: true,
      }),
    ).toBeVisible()
    const sellerId = page.url().split('/').at(-1)!
    const countWelcome = async () =>
      (
        await f.db.query(
          "select count(*)::int n from seller_communications where seller_id=$1 and template_key='seller.welcome'",
          [sellerId],
        )
      ).rows[0].n
    expect(await countWelcome()).toBe(1)
    const replay = await page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: registration,
    })
    expect(replay.ok()).toBe(true)
    expect(await countWelcome()).toBe(1)
    await page.goto(`/intake/sellers/${sellerId}#seller-communication`)
    // A queued row precedes delivery recording. Await the command's outcome,
    // not the intermediate count, before asserting the persisted status.
    const deliveryResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/communications') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON().welcome === true,
    )
    await page
      .getByRole('button', {
        name: d.communications.welcomeResend,
        exact: true,
      })
      .click()
    const response = await deliveryResponse
    expect(response.ok()).toBe(true)
    const outcome = await response.json()
    expect(outcome.ok).toBe(true)
    await expect.poll(countWelcome).toBe(2)
    const welcome = await f.db.query(
      "select body,status from seller_communications where seller_id=$1 and id=$2 and template_key='seller.welcome'",
      [sellerId, outcome.id],
    )
    expect(welcome.rows).toHaveLength(1)
    expect(welcome.rows[0].status).toBe(outcome.delivery)
    expect(welcome.rows[0].body).toContain('/register?next=%2Fseller&locale=sv')
    expect(welcome.rows[0].status).not.toBe('queued')
  } finally {
    await f.close()
  }
})
