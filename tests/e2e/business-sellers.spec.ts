import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }

test('reviewed CSV import preserves explicit business identity', async ({
  page,
}) => {
  const email = `business-import-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    await expect(
      page.getByRole('button', { name: d.importer.chooseFile, exact: true }),
    ).toBeEnabled()
    await page.locator('#import-file').setInputFiles({
      name: 'synthetic-business.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,email,phone,sellerType,companyName,vatRegistered,vatNumber\nImported business,imported@example.test,,business,Synthetic import company,true,XX123\n',
      ),
    })
    await expect(page.locator('.import-preview-table')).toContainText(
      'Synthetic import company',
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1 and seller_type=$2',
          [f.tenant, 'business'],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('button', { name: d.importer.import, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.importer.completed)
    expect(
      (
        await f.db.query(
          'select seller_type,profile from sellers where tenant_id=$1 and email=$2',
          [f.tenant, 'imported@example.test'],
        )
      ).rows[0],
    ).toMatchObject({
      seller_type: 'business',
      profile: {
        business: {
          companyName: 'Synthetic import company',
          vatRegistered: true,
          vatNumber: 'XX123',
        },
      },
    })
  } finally {
    await f.close()
  }
})

test('staff registers a business, safely retries, filters its directory and sees frozen sale reporting', async ({
  page,
}, testInfo) => {
  const email = `business-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/intake/sellers/new')
    await page
      .getByLabel(d.sellerDetails.business.type, { exact: true })
      .selectOption('business')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic business')
    await page.getByLabel(d.intake.phone, { exact: true }).fill('0701234567')
    await page.getByLabel(d.intake.email, { exact: true }).fill(email)
    await page
      .getByLabel(d.sellerDetails.business.companyName, { exact: true })
      .fill('Synthetic Company AB')
    await page
      .getByLabel(d.sellerDetails.business.vatNumber, { exact: true })
      .fill('SE123456789001')
    await page
      .getByLabel(d.sellerDetails.business.vatRegistered, { exact: true })
      .check()
    const attempts: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'registerSeller') return route.continue()
      attempts.push(command)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (attempts.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/sellers\/[a-f0-9-]+$/)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    const seller = new URL(page.url()).pathname.split('/').at(-1)!
    const identity = (
      await f.db.query('select seller_type,profile from sellers where id=$1', [
        seller,
      ])
    ).rows[0]
    expect(identity).toMatchObject({
      seller_type: 'business',
      profile: {
        business: { vatRegistered: true, companyName: 'Synthetic Company AB' },
      },
    })
    await page.goto(`/intake/sellers/${seller}#seller-details`)
    await expect(
      page.getByText('Synthetic Company AB', { exact: true }).first(),
    ).toBeVisible()
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await expect(page.locator('select[name="sellerType"]')).toHaveCount(0)
    await page
      .getByLabel(d.sellerDetails.business.contactPerson, { exact: true })
      .fill('Synthetic contact')
    await page
      .getByRole('button', { name: d.sellerDetails.save, exact: true })
      .click()
    await expect(
      page.getByText(d.sellerDetails.saved, { exact: true }),
    ).toBeVisible()
    const item = randomUUID(),
      review = randomUUID()
    await f.asActor(f.actor, async () => {
      const bag = (
        await f.db.query(
          'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
          [f.tenant, randomUUID(), seller, '', f.agreement],
        )
      ).rows[0].id
      await f.db.query(
        'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
        [
          f.tenant,
          randomUUID(),
          bag,
          review,
          'Synthetic business jacket',
          'Jackets',
          'Good',
        ],
      )
      await f.db.query(
        "select accept_item($1,$2,'reception_review',$3,1,25000)",
        [f.tenant, item, review],
      )
      await f.db.query(
        "select record_sale($1,$2,'manual',$3,now()-interval '1 day','SEK',$4)",
        [
          f.tenant,
          randomUUID(),
          `business-${item}`,
          JSON.stringify([{ itemId: item, priceOre: 25000 }]),
        ],
      )
    })
    await page.goto('/intake/sellers?type=business&order=available:desc')
    await expect(page.locator('.compact-directory tbody tr')).toHaveCount(1)
    await expect(page.locator('.compact-directory')).toContainText(
      'Synthetic business',
    )
    await expect(page.locator('.compact-directory')).toContainText('62,50')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('business-directory-ipad.png'),
    })
    await page.goto('/intake/economy')
    await page
      .getByText(d.sellerDetails.business.report, { exact: true })
      .click()
    const report = page
      .locator('details')
      .filter({
        has: page.getByText(d.sellerDetails.business.report, { exact: true }),
      })
      .first()
    await report
      .getByLabel(d.sellerDetails.business.type, { exact: true })
      .selectOption('business')
    await expect(
      report.getByRole('heading', {
        name: d.sellerDetails.business.business,
        exact: true,
      }),
    ).toBeVisible()
    await expect(report).toContainText('250,00')
    await expect(
      report.getByRole('heading', {
        name: d.sellerDetails.business.private,
        exact: true,
      }),
    ).toHaveCount(0)

    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(
      'sv-SE',
      { timeZone: 'Europe/Stockholm' },
    )
    await f.asActor(f.actor, async () => {
      const close = (
        await f.db.query('select generate_day_close($1,$2,$3) id', [
          f.tenant,
          randomUUID(),
          yesterday,
        ])
      ).rows[0].id
      await f.db.query('select publish_accounting_map($1,$2,null,$3)', [
        f.tenant,
        randomUUID(),
        JSON.stringify({
          grossOre: { account: '1930', side: 'debit' },
          sellerCreditOre: { account: '2890', side: 'credit' },
          commissionOre: { account: '3010', side: 'credit' },
          commissionVatOre: { account: '2610', side: 'credit' },
        }),
      ])
      const voucher = (
        await f.db.query('select preview_voucher($1,$2) value', [
          f.tenant,
          close,
        ])
      ).rows[0].value
      expect(voucher.balanced).toBe(true)
      expect(voucher.debitOre).toBe(25000)
      await f.db.query('select export_day_close($1,$2,$3)', [
        f.tenant,
        randomUUID(),
        close,
      ])
    })
    await page.goto(`/intake/sellers/${seller}#seller-economy`)
    const statementForm = page
      .locator('form')
      .filter({ has: page.locator('#statement-from') })
    await statementForm
      .getByLabel(d.statements.from, { exact: true })
      .fill(yesterday)
    await statementForm
      .getByLabel(d.statements.to, { exact: true })
      .fill(yesterday)
    await statementForm.getByRole('checkbox').check()
    await statementForm
      .getByRole('button', { name: d.statements.issue, exact: true })
      .click()
    await statementForm
      .getByRole('link', { name: d.statements.open, exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: en.statements.selfBilling + ' 1',
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.self-billing-details')).toContainText(
      'Synthetic Company AB',
    )
    await expect(page.locator('.self-billing-details')).toContainText(
      '12.50 SEK',
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    const statementId = new URL(page.url()).pathname.split('/').at(-1)!
    const url = await page
      .getByRole('link', { name: en.statements.downloadPdf, exact: true })
      .getAttribute('href')
    const pdf = await page.request.get(url!)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()['cache-control']).toContain('no-store')
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    await page.screenshot({
      path: testInfo.outputPath('self-billing-ipad.png'),
      fullPage: true,
    })
    const sellerPdf = await page.request.get(
      `/api/seller/statement/pdf?tenant=${f.tenant}&seller=${seller}&statement=${statementId}`,
    )
    expect(sellerPdf.status()).toBe(200)
    expect((await sellerPdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    const forbidden = await page.request.get(
      `/api/seller/statement/pdf?tenant=${f.tenant}&seller=${f.seller}&statement=${statementId}`,
    )
    expect(forbidden.status()).toBe(404)
    const wrongTenant = await page.request.get(
      `/api/statements/pdf?tenant=${randomUUID()}&statement=${statementId}`,
    )
    expect(wrongTenant.status()).toBe(409)
  } finally {
    await f.close()
  }
})
