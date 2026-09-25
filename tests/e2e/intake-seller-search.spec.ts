import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('bag intake finds all sellers by contact and focuses reception without skipping required agreement', async ({
  page,
}, testInfo) => {
  const email = 'intake-search-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 53; i++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'Paged intake ' + String(i).padStart(2, '0'),
        'bag-' + randomUUID() + '@example.test',
        '0701111111',
      ])
    const target = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'ZZ Intake target',
        'intake-target@example.test',
        '0708765432',
      ])
    ).rows[0].id
    await f.db.query(
      'select publish_seller_agreement($1,$2,$3,$4,$5,$6,true) id',
      [
        f.tenant,
        randomUUID(),
        f.agreement,
        'Required synthetic agreement',
        'Synthetic test terms',
        'sv',
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake?q=Paged&sellerPage=5')
    const rows = page.locator('.intake-seller-results li')
    const search = page.getByLabel(d.sellersList.search, { exact: true })
    await expect(rows).toHaveCount(5)
    await expect(
      page.getByRole('link', { name: d.sellersList.nextPage, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .click()
    await expect(rows).toHaveCount(12)
    expect(new URL(page.url()).searchParams.get('q')).toBe('Paged')
    await search.fill('0708765432')
    await page
      .locator('form')
      .filter({ has: search })
      .getByRole('button')
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('ZZ Intake target')
    expect(new URL(page.url()).searchParams.has('sellerPage')).toBe(false)
    await rows.getByRole('link').click()
    await expect(page).toHaveURL('/intake?seller=' + target + '#new-seller')
    const receiving = page.locator('#new-seller')
    await expect
      .poll(async () => (await receiving.boundingBox())?.y ?? 9999)
      .toBeLessThan(100)
    await expect(page.locator('.agreement-at-intake')).toHaveAttribute(
      'open',
      '',
    )
    await expect(
      receiving.getByRole('button', { name: d.intake.saveBag, exact: true }),
    ).toBeDisabled()
    await expect(receiving).toContainText(d.intake.agreementRequired)
    await page.screenshot({
      path: testInfo.outputPath('intake-selected-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const evidenceForm = receiving.locator('.agreement-evidence-form')
    await evidenceForm
      .getByLabel(d.agreements.reference, { exact: true })
      .fill('Synthetic paper evidence')
    await evidenceForm
      .getByLabel(d.agreements.confirmEvidence, { exact: true })
      .check()
    await evidenceForm
      .getByRole('button', { name: d.agreements.record, exact: true })
      .click()
    await expect(
      receiving.getByRole('button', { name: d.intake.saveBag, exact: true }),
    ).toBeEnabled()
    await expect(
      receiving.getByRole('heading', { name: d.intake.receive, exact: true }),
    ).toBeInViewport()
    await receiving
      .getByLabel(d.intake.note, { exact: true })
      .fill('Synthetic received item')
    await receiving.getByLabel(d.intake.custody, { exact: true }).check()
    await receiving
      .getByRole('button', { name: d.intake.saveBag, exact: true })
      .click()
    await expect(receiving.getByRole('status')).toContainText(d.intake.saved)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from bag_receipts where tenant_id=$1 and seller_id=$2',
          [f.tenant, target],
        )
      ).rows[0].n,
    ).toBe(1)
    await receiving
      .getByRole('link', { name: d.quickIntake.changeSeller, exact: true })
      .click()
    await expect(search).toBeInViewport()
    await search.fill('intake-target@example.test')
    await page
      .locator('form')
      .filter({ has: search })
      .getByRole('button')
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('ZZ Intake target')
    await page
      .getByRole('link', { name: d.sellersList.clear, exact: true })
      .click()
    await expect(search).toHaveValue('')
    await expect(rows).toHaveCount(12)
    await page.goto('/intake?q=Paged&sellerPage=999')
    await expect(rows).toHaveCount(5)
    expect(new URL(page.url()).searchParams.get('sellerPage')).toBe('5')
    await search.fill('No matching intake seller')
    await page
      .locator('form')
      .filter({ has: search })
      .getByRole('button')
      .click()
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText(d.intake.noSellers, { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
