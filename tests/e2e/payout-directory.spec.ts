import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('open payout work stays reachable beyond completed history and protects paged drafts', async ({
  page,
}) => {
  const email = `payout-directory-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select adjust_seller_ledger($1,$2,$3,50000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic history credit',
    ])
    for (let n = 0; n < 53; n++) {
      const id = randomUUID()
      await f.db.query('select request_payout($1,$2,$3,10000)', [
        f.tenant,
        id,
        f.seller,
      ])
      await f.db.query('select reject_payout($1,$2,$3,$4)', [
        f.tenant,
        randomUUID(),
        id,
        `Synthetic history ${n}`,
      ])
    }
    for (let n = 0; n < 26; n++) {
      const seller = (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          f.tenant,
          randomUUID(),
          `Synthetic payout seller ${String(n).padStart(2, '0')}`,
          '',
          `070900${String(n).padStart(4, '0')}`,
        ])
      ).rows[0].id
      await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
        f.tenant,
        randomUUID(),
        seller,
        'Synthetic open credit',
      ])
      await f.db.query('select request_payout($1,$2,$3,10000)', [
        f.tenant,
        randomUUID(),
        seller,
      ])
    }
    const last = (
      await f.db.query(
        "select id from payouts where tenant_id=$1 and status='requested' order by requested_at,id offset 25 limit 1",
        [f.tenant],
      )
    ).rows[0].id
    await f.commit()
    await page.goto('/intake/payouts')
    const open = page.getByTestId('payout-list'),
      history = page.getByTestId('payout-history-list')
    await expect(open.locator('.payout-entry')).toHaveCount(25)
    await expect(open).toContainText(
      d.payouts.listCount.replace('{count}', '26'),
    )
    await page
      .getByRole('tab', { name: d.payouts.tabs.history, exact: true })
      .click()
    await expect(history).toContainText(
      d.payouts.listCount.replace('{count}', '53'),
    )
    await expect(history.locator('.payout-entry')).toHaveCount(25)
    for (let n = 0; n < 2; n++) {
      await history
        .getByRole('link', { name: d.sellersList.nextPage, exact: true })
        .first()
        .click()
      await expect(
        history
          .getByText(
            d.sellersList.pageOf
              .replace('{page}', String(n + 2))
              .replace('{pages}', '3'),
            { exact: true },
          )
          .first(),
      ).toBeVisible()
    }
    await expect(history.locator('.payout-entry')).toHaveCount(3)
    await page
      .getByRole('tab', { name: d.payouts.tabs.open, exact: true })
      .click()
    await open
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect(open.locator('.payout-entry')).toHaveCount(1)
    await open.locator('.payout-decision > summary').click()
    const reason = open.locator(`#reason-${last}`)
    await reason.fill('Synthetic retained reason')
    await page
      .getByRole('tab', { name: d.payouts.tabs.history, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.payouts.tabs.open, exact: true })
      .click()
    await expect(reason).toHaveValue('Synthetic retained reason')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await open
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .first()
      .click()
    await expect.poll(() => warnings).toBe(1)
    await expect(reason).toHaveValue('Synthetic retained reason')
    await reason.fill('')
    await open
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .first()
      .click()
    await expect(open.locator('.payout-entry')).toHaveCount(25)
    expect(warnings).toBe(1)
    await open
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect(open.locator('.payout-entry')).toHaveCount(1)
    await open.locator('.payout-decision > summary').click()
    await reason.fill('Synthetic final-page rejection')
    await open
      .getByRole('button', { name: d.payouts.reject, exact: true })
      .click()
    await expect(open.locator('.payout-entry')).toHaveCount(25)
    await expect(page).not.toHaveURL(/openPage=2/)
    await expect(open).toContainText(
      d.payouts.listCount.replace('{count}', '25'),
    )
    await page
      .getByRole('tab', { name: d.payouts.tabs.history, exact: true })
      .click()
    await expect(history).toContainText(
      d.payouts.listCount.replace('{count}', '54'),
    )
    await page.setViewportSize({ width: 320, height: 720 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/payout-history-mobile.png',
      fullPage: true,
    })
    expect(
      (await f.db.query('select status from payouts where id=$1', [last]))
        .rows[0].status,
    ).toBe('rejected')
    expect(
      (
        await f.db.query(
          "select count(*)::int n from payouts where tenant_id=$1 and status='paid'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
