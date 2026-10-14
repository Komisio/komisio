import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff correct text, classify inventory and download private A4 price labels', async ({
  page,
}, testInfo) => {
  const email = `workflow-${randomUUID()}@example.test`
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic blue coat')
    await f.commit()
    await page.goto(`/intake/items/${item}`)
    await page
      .getByRole('button', {
        name: `${d.itemWorkflow.editRow} ${d.items.item}: Synthetic blue coat`,
        exact: true,
      })
      .click()
    await page
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Synthetic blue wool coat')
    await page
      .getByRole('textbox', { name: d.items.item, exact: true })
      .press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic blue wool coat',
    )
    await page.goto(`/intake/items/classify?item=${item}`)
    await page
      .locator('summary')
      .filter({ hasText: d.itemWorkflow.newGroup })
      .click()
    await page.getByLabel(d.itemWorkflow.name, { exact: true }).fill('Premium')
    await page
      .getByRole('button', { name: d.itemWorkflow.createGroup, exact: true })
      .click()
    await expect(
      page.getByLabel(d.itemWorkflow.group, { exact: true }).locator('option'),
    ).toContainText(['Välj…', 'Ingen', 'Premium'])
    await page
      .getByLabel(d.quickIntake.itemType, { exact: true })
      .selectOption('jacket')
    await page
      .getByLabel(d.itemWorkflow.group, { exact: true })
      .selectOption({ label: 'Premium' })
    await page
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect
      .poll(async () =>
        Number(
          (
            await f.db.query(
              'select max(version) v from item_classification_versions where item_id=$1',
              [item],
            )
          ).rows[0].v,
        ),
      )
      .toBe(2)
    await page.goto('/intake/items')
    const row = page
      .getByRole('row')
      .filter({ hasText: 'Synthetic blue wool coat' })
    await expect(row).toContainText('Premium')
    await row.getByRole('checkbox').check()
    await page
      .getByRole('button', { name: d.labelSheets.title, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.labelSheets.title }),
    ).toBeVisible()
    await expect(page.getByRole('row')).toContainText(
      'Synthetic blue wool coat',
    )
    const pdf = await page.request.get(
      `/api/items/labels?tenant=${f.tenant}&items=${item}&size=57x32&copies=2`,
    )
    expect(pdf.ok()).toBe(true)
    expect(pdf.headers()['cache-control']).toBe('private, no-store')
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    expect(
      (
        await page.request.get(
          `/api/items/labels?tenant=${randomUUID()}&items=${item}`,
        )
      ).status(),
    ).toBe(409)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('labels-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('seller saves bank details and owner explicitly reviews the payout destination', async ({
  page,
  browser,
}, testInfo) => {
  const owner = `bank-owner-${randomUUID()}@example.test`
  await register(page, owner, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(owner),
    sellerContext = await browser.newContext(),
    sellerPage = await sellerContext.newPage()
  try {
    const email = (
      await f.db.query('select email from sellers where id=$1', [f.seller])
    ).rows[0].email
    await f.commit()
    await register(
      sellerPage,
      email,
      'K!' + randomBytes(16).toString('hex'),
      '/seller',
    )
    await sellerPage.goto(`/seller?seller=${f.seller}`)
    await sellerPage.locator('#portal-bank summary').click()
    await sellerPage
      .getByLabel(d.sellerBank.holder, { exact: true })
      .fill('Synthetic account holder')
    await sellerPage
      .getByLabel(d.sellerBank.country, { exact: true })
      .selectOption('SE')
    await sellerPage
      .getByLabel(d.sellerBank.kind, { exact: true })
      .selectOption('local')
    await sellerPage
      .getByLabel(d.sellerBank.account, { exact: true })
      .fill('123456789')
    await sellerPage
      .getByLabel(d.sellerBank.routing, { exact: true })
      .fill('1234')
    await sellerPage
      .locator('#portal-bank')
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect
      .poll(async () =>
        Number(
          (
            await f.db.query(
              'select count(*) n from seller_bank_versions where seller_id=$1',
              [f.seller],
            )
          ).rows[0].n,
        ),
      )
      .toBe(1)
    await f.asActor(f.actor, async () => {
      await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic credit',
      ])
      await f.db.query('select request_payout($1,$2,$3,10000)', [
        f.tenant,
        randomUUID(),
        f.seller,
      ])
    })
    await page.goto('/intake/payouts')
    await page.locator('.payout-bank summary').first().click()
    await expect(page.locator('.payout-bank').first()).toContainText(
      '123456789',
    )
    await page
      .getByRole('button', { name: d.sellerBank.use, exact: true })
      .click()
    await expect(
      page.getByText(d.sellerBank.reviewed, { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('bank-review.png'),
      fullPage: true,
    })
  } finally {
    await sellerContext.close()
    await f.close()
  }
})
