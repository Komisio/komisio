import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { decodeRenderedCode128 } from '../helpers/rendered-barcode'
import d from '../../messages/sv.json' with { type: 'json' }

test('receive with an assortment, print four attributes and find the group in stock', async ({
  page,
}, testInfo) => {
  const email = `assortment-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const group = randomUUID()
    await f.db.query(
      "select create_assortment_group($1,$2,'Synthetic standard')",
      [f.tenant, group],
    )
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic blue trousers')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('200')
    await page
      .getByLabel(d.quickIntake.assortment, { exact: true })
      .selectOption(group)
    await page
      .getByLabel(d.quickIntake.itemType, { exact: true })
      .selectOption({ label: 'Byxor' })
    for (const [label, value] of [
      ['Märke', 'Example'],
      ['Färg', 'Blå'],
      ['Storlek', 'M'],
      ['Material', 'Ull'],
    ]) {
      await page.getByLabel(label, { exact: true }).fill(value)
    }
    await page.screenshot({
      path: testInfo.outputPath('receiving.png'),
      fullPage: true,
    })
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake/quick') &&
        r.request().method() === 'POST',
    )
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    const result = await response
    expect(result.status()).toBe(200)
    const body = await result.json()
    expect(body.itemId).toBeTruthy()
    await page.goto(`/intake/items/${body.itemId}/label`)
    const label = page.locator('.item-browser-label')
    for (const text of [
      'Märke: Example',
      'Färg: Blå',
      'Storlek: M',
      'Material: Ull',
    ])
      await expect(label).toContainText(text)
    const image = label.locator('img')
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true)
    expect((await decodeRenderedCode128(await image.screenshot())).text).toBe(
      body.reference,
    )
    await page.screenshot({
      path: testInfo.outputPath('label.png'),
      fullPage: true,
    })
    for (const size of ['50x50', '57x32']) {
      const pdf = await page.request.get(
        `/api/items/labels?tenant=${f.tenant}&items=${body.itemId}&size=${size}`,
      )
      expect(pdf.status()).toBe(200)
      await testInfo.attach(`label-${size}.pdf`, {
        body: await pdf.body(),
        contentType: 'application/pdf',
      })
    }
    await page.goto('/intake/stock#stock-assortments')
    const row = page.getByRole('row').filter({ hasText: 'Synthetic standard' })
    await expect(row).toContainText('200,00 kr')
    await expect(row.getByRole('cell').first()).toHaveText('1')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('stock-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('seller profile bank details are visible to owner and absent for staff', async ({
  page,
  browser,
}, testInfo) => {
  const email = `bank-profile-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const staff = await browser.newContext()
  try {
    await f.commit()
    const sellerEmail = (
      await f.db.query(
        'select email from sellers where tenant_id=$1 and id=$2',
        [f.tenant, f.seller],
      )
    ).rows[0].email
    const sellerUser = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [sellerUser, sellerEmail],
    )
    await f.asActor(sellerUser, () =>
      f.db.query('select save_seller_bank_details($1,$2,$3,null,$4)', [
        f.tenant,
        randomUUID(),
        f.seller,
        {
          holder: 'Synthetic holder',
          country: 'SE',
          kind: 'local',
          account: '123456789012',
          routing: '1234',
        },
      ]),
    )
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    const account = page.locator('#seller-bank')
    await expect(account).toBeVisible()
    await expect(account).toContainText('123456789012')
    await expect(account).toContainText('1234')
    await expect(account).toContainText(d.sellerBank.profileHint)
    await expect(account.locator('input')).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('owner-bank.png'),
      fullPage: true,
    })
    const staffPage = await staff.newPage()
    const staffEmail = `bank-staff-${randomUUID()}@example.test`
    await register(
      staffPage,
      staffEmail,
      `K!${randomBytes(16).toString('hex')}`,
    )
    const staffId = (
      await f.db.query('select id from auth.users where email=$1', [staffEmail])
    ).rows[0].id
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
      [f.tenant, staffId],
    )
    const document = await staffPage.goto(
      `/intake/sellers/${f.seller}#seller-details`,
    )
    await expect(
      staffPage.getByRole('heading', {
        name: 'Synthetic P2 seller',
        exact: true,
      }),
    ).toBeVisible()
    await expect(staffPage.locator('#seller-bank')).toHaveCount(0)
    expect(await document!.text()).not.toContain('123456789012')
  } finally {
    await staff.close()
    await f.close()
  }
})
