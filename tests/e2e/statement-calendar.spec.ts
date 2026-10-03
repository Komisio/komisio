import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test.use({ timezoneId: 'America/Los_Angeles' })

test('statement defaults are closed and selected days use Stockholm despite the browser timezone', async ({
  page,
}) => {
  const email = `statement-days-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic historical statement item')
    await f.db.query(
      "select record_sale($1,$2,'manual','Synthetic historical statement sale','2025-03-30T12:00:00Z','SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const help = page.locator('.statement-help')
    await expect(help.locator('summary')).toBeVisible()
    await expect(help.locator('p')).not.toBeVisible()
    await help.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(help.locator('p')).toHaveText(d.statements.issueHint)
    await expect(help.locator('p')).toBeVisible()
    await help.locator('summary').click()
    await expect(help.locator('p')).not.toBeVisible()
    await help.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'private/statement-compact-mobile.png' })
    const from = page.getByLabel(d.statements.from, { exact: true })
    const to = page.getByLabel(d.statements.to, { exact: true })
    const today = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Stockholm',
    })
    const yesterday = new Date(`${today}T00:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const closedDay = yesterday.toISOString().slice(0, 10)
    await expect(
      page.getByText(d.statements.closedPeriodHint, { exact: true }),
    ).toBeVisible()
    await expect(to).toHaveValue(closedDay)
    await expect(to).toHaveAttribute('max', closedDay)
    await expect(from).toHaveValue(closedDay.slice(0, 7) + '-01')
    await page.getByLabel(d.statements.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.statements.issue, exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: d.statements.open, exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from settlement_statements where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await expect(
      page.getByLabel(d.statements.confirm, { exact: true }),
    ).not.toBeChecked()
    await page.getByLabel(d.statements.confirm, { exact: true }).check()
    await from.fill('2025-03-30')
    await expect(
      page.getByLabel(d.statements.confirm, { exact: true }),
    ).not.toBeChecked()
    await to.fill('2025-03-30')
    await expect(
      page.getByRole('link', { name: d.statements.open, exact: true }),
    ).toHaveCount(0)
    await page.getByLabel(d.statements.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.statements.issue, exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              'select count(*)::int n from settlement_statements where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
      )
      .toBe(2)
    const statement = (
      await f.db.query(
        'select id,period_from,period_to,sales_gross_ore,credited_ore from settlement_statements where tenant_id=$1 and number=2',
        [f.tenant],
      )
    ).rows[0]
    expect(statement.period_from.toISOString()).toBe('2025-03-29T23:00:00.000Z')
    expect(statement.period_to.toISOString()).toBe('2025-03-30T22:00:00.000Z')
    expect(statement.sales_gross_ore).toBe('20000')
    expect(statement.credited_ore).toBe('8000')
    const issuedLink = page.getByRole('link', {
      name: d.statements.open,
      exact: true,
    })
    await expect(issuedLink).toHaveAttribute(
      'href',
      `/intake/statements/${statement.id}`,
    )
    await issuedLink.click()
    await expect(page).toHaveURL(
      new RegExp(`/intake/statements/${statement.id}$`),
    )
    await expect(
      page.getByRole('heading', { name: d.statements.title, exact: false }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
  } finally {
    await f.close()
  }
})
