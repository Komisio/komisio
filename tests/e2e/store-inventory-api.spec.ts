import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }

test('a store admin issues a scoped key, writes directly and revokes access', async ({
  page: ownerPage,
}) => {
  const email = `store-api-${randomUUID()}@example.test`
  await register(ownerPage, email, 'K!' + randomUUID())
  const f = await p2Fixture(email)
  const adminContext = await ownerPage
    .context()
    .browser()!
    .newContext({ baseURL: new URL(ownerPage.url()).origin })
  try {
    const id = await f.item('Inventory API jacket')
    await f.commit()
    const page = await adminContext.newPage()
    const adminEmail = 'api-admin-' + randomUUID() + '@example.test'
    await register(page, adminEmail, 'K!' + randomUUID())
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) select $1,id,'admin' from auth.users where email=$2",
      [f.tenant, adminEmail],
    )
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
    const [first, retry] = await Promise.all([submit(), submit()])
    expect(first.status()).toBe(200)
    expect(retry.status()).toBe(200)
    const receipt = await first.json()
    expect(await retry.json()).toEqual(receipt)
    expect(receipt.status).toBe('executed')
    expect(
      await (await page.request.get(receipt.statusUrl, { headers })).json(),
    ).toMatchObject({
      status: 'executed',
      id: receipt.id,
      resultId: receipt.resultId,
    })
    expect(
      await (
        await page.request.get('/api/public/v1/sellers/' + receipt.resultId, {
          headers,
        })
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
    await adminContext.close()
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
