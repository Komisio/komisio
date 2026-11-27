import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }

test('store staff can issue a scoped key, review a submitted change and revoke access', async ({
  page,
}) => {
  const email = `store-api-${randomUUID()}@example.test`
  await register(page, email, 'K!' + randomUUID())
  const f = await p2Fixture(email)
  const reviewer = await page
    .context()
    .browser()!
    .newContext({ baseURL: new URL(page.url()).origin })
  try {
    const id = await f.item('Inventory API jacket')
    await f.commit()
    await page.goto('/intake/integrations')
    await page
      .getByRole('link', { name: sv.storeApi.title, exact: true })
      .click()
    await page.getByLabel(sv.storeApi.label).fill('Stock reader')
    await page
      .getByRole('checkbox', { name: 'sellers:write', exact: true })
      .check()
    await page
      .getByRole('checkbox', { name: 'sellers:read', exact: true })
      .check()
    await page.getByRole('button', { name: sv.storeApi.create }).click()
    const key = page.getByLabel(sv.storeApi.copy)
    await expect(key).toBeVisible()
    const headers = { Authorization: 'Bearer ' + (await key.inputValue()) }
    const response = await page.request.get('/api/public/v1/items/' + id, {
      headers,
    })
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      title: 'Inventory API jacket',
      priceMinor: 20000,
      currency: 'SEK',
    })
    const replay = randomUUID()
    const submit = () =>
      page.request.post('/api/public/v1/sellers', {
        headers: { ...headers, 'Idempotency-Key': replay },
        data: { name: 'API fixture seller', phone: '0700000000' },
      })
    const receipt = await submit()
    expect(receipt.status()).toBe(202)
    const { id: operation, statusUrl } = await receipt.json()
    expect((await (await submit()).json()).id).toBe(operation)
    const who = await reviewer.newPage()
    const adminEmail = 'api-review-' + randomUUID() + '@example.test'
    await register(who, adminEmail, 'K!' + randomUUID())
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) select $1,id,'admin' from auth.users where email=$2",
      [f.tenant, adminEmail],
    )
    await who.goto('/intake/operations/' + operation)
    await expect(
      who.getByText('API fixture seller', { exact: true }),
    ).toBeVisible()
    await who
      .getByRole('button', { name: sv.operations.approve, exact: true })
      .click()
    const readStatus = async () =>
      await (await page.request.get(statusUrl, { headers })).json()
    await expect.poll(async () => (await readStatus()).status).toBe('executed')
    expect(
      await (
        await page.request.get(
          '/api/public/v1/sellers/' + (await readStatus()).resultId,
          { headers },
        )
      ).json(),
    ).toMatchObject({ name: 'API fixture seller' })
    expect(
      (await page.request.get('/api/public/v1/payouts', { headers })).status(),
    ).toBe(403)
    await page.reload()
    await expect(key).toHaveCount(0)
    const revoke = page.getByRole('button', {
      name: sv.storeApi.revoke + ' Stock reader',
    })
    await revoke.click()
    await expect(revoke).toHaveCount(0)
    expect(
      (await page.request.get('/api/public/v1/items', { headers })).status(),
    ).toBe(401)
  } finally {
    await reviewer.close()
    await f.close()
  }
})

test('developers can explore both endpoints and execute a same-origin inventory read', async ({
  page,
}) => {
  await page.goto('/developers/api')
  await expect(
    page.getByRole('heading', { name: /Komisio Store API/ }),
  ).toBeVisible()
  const link = page.getByRole('link', { name: 'Download the OpenAPI document' })
  const schema = await page.request.get((await link.getAttribute('href'))!)
  expect((await schema.json()).paths).toHaveProperty('/items/{id}')
  const op = page.locator('#operations-default-listStoreItems')
  await op
    .getByRole('button', { name: /List store inventory/ })
    .first()
    .click()
  await op.getByRole('button', { name: 'Try it out' }).click()
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/public/v1/items',
  )
  await op.getByRole('button', { name: 'Execute' }).click()
  expect((await response).status()).toBe(401)
  await expect(op.getByText(/"INVALID_KEY"/).first()).toBeVisible()
})
