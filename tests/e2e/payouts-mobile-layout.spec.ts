import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
const p = d.payouts

// The payouts page on a phone: decisions first (settlement, open payouts),
// the on-behalf request folded near the top, and a truthful message about
// its bounded seller list instead of an empty form. No money moves: the
// journey ends at an approved payout, nothing is marked paid.
test('payouts page keeps decisions first and folds the request form on mobile', async ({
  page,
  browser,
}, testInfo) => {
  const email = `payouts-mobile-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    // Two sold items give the fixture seller 160 SEK of credit, above the 100 SEK minimum.
    const items = [
      await f.item('Mobile sold one'),
      await f.item('Mobile sold two'),
    ]
    await f.db.query(
      "select record_sale($1,$2,'manual','MOBILE-1',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify(items.map((itemId) => ({ itemId, priceOre: 20000 }))),
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/payouts')
    const settle = page.locator('section', {
      has: page.getByRole('heading', { name: p.settleHeading, exact: true }),
    })
    const list = page.getByTestId('payout-list')
    const request = page.getByTestId('payout-request')
    // Document position, not viewport position, so an already scrolled page cannot pass by accident.
    const top = async (locator: typeof settle) =>
      (await locator.boundingBox())!.y +
      (await page.evaluate(() => window.scrollY))
    // Order: the folded request one line from the top, then the settlement, then the payout list.
    await expect(request).toBeVisible()
    await expect(settle).toBeVisible()
    await expect(list).toBeVisible()
    expect(await top(request)).toBeLessThan(await top(settle))
    expect(await top(settle)).toBeLessThan(await top(list))
    expect(
      await request.evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(false)
    await expect(request.locator('summary')).toContainText(p.requestHeading)
    // Folded, the request takes one line: the settlement starts within the first screen.
    expect(await top(settle)).toBeLessThan(720)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    // With credit available the manual request is still there, one tap away.
    await request.locator('summary').click()
    await expect(
      request.getByText(p.requestHint, { exact: true }),
    ).toBeVisible()
    const select = request.getByLabel(p.seller, { exact: true })
    await expect(select).toBeVisible()
    await expect(select.locator('option')).toHaveCount(1)
    await expect(select.locator('option')).toContainText('160.00 SEK')
    await expect(
      request.getByRole('button', { name: p.request, exact: true }),
    ).toBeVisible()
    await expect(
      request.getByRole('link', { name: p.directory, exact: true }),
    ).toHaveAttribute('href', '/intake/sellers')
    await request.locator('summary').click()

    // Settle through the page: the credit is reserved, the approved payout appears.
    await expect(settle.getByText(/160\.00 SEK/).first()).toBeVisible()
    await settle
      .getByLabel(p.settleReason, { exact: true })
      .fill('Synthetic mobile settlement')
    await settle.getByLabel(p.settleConfirm, { exact: true }).check()
    await settle
      .getByRole('button', {
        name: p.settle.replace('{count}', '1'),
        exact: true,
      })
      .click()
    await expect(page.getByText(p.settled, { exact: true })).toBeVisible()
    // The page refreshes itself after the batch; wait for the refreshed facts, no reload.
    await expect(page.getByText(p.settleEmpty, { exact: true })).toBeVisible()
    const approved = list.locator('.intake-notice', {
      hasText: p.statuses.approved,
    })
    await expect(approved).toHaveCount(1)
    await expect(approved).toContainText('160.00 SEK')
    // The approved payout is within the first two phone screens of the document, the request still folded above it.
    expect(await top(approved)).toBeLessThan(720 * 2)
    expect(await top(request)).toBeLessThan(await top(approved))
    expect(
      await request.evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(false)
    await page.screenshot({
      path: testInfo.outputPath('payouts-after-settlement-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    // The bounded request list is now empty: say so about this list, keep the way to any seller.
    await request.locator('summary').click()
    await expect(request.getByRole('status')).toHaveText(p.requestNone)
    await expect(request.getByLabel(p.seller, { exact: true })).toHaveCount(0)
    await expect(request.getByText(p.requestHint, { exact: true })).toHaveCount(
      0,
    )
    await expect(
      request.getByRole('link', { name: p.directory, exact: true }),
    ).toHaveAttribute('href', '/intake/sellers')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    // Nothing was paid: the approved payout still waits for its bank reference.
    const rows = (
      await f.db.query(
        'select status,amount_ore,paid_at from payouts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(rows).toEqual([
      { status: 'approved', amount_ore: '16000', paid_at: null },
    ])

    // A readonly member sees the same order and no way to write.
    const readerEmail = `payouts-reader-${randomUUID()}@example.test`
    const reader = await browser.newContext({
      baseURL: 'http://127.0.0.1:3000',
    })
    try {
      const readerPage = await reader.newPage()
      await register(
        readerPage,
        readerEmail,
        `K!${randomBytes(16).toString('hex')}`,
      )
      await expect(readerPage).toHaveURL(/\/onboarding$/)
      const uid = (
        await f.db.query('select id from auth.users where email=$1', [
          readerEmail,
        ])
      ).rows[0].id
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'readonly')",
        [f.tenant, uid],
      )
      await readerPage.setViewportSize({ width: 320, height: 720 })
      await readerPage.goto('/intake/payouts')
      const readerRequest = readerPage.getByTestId('payout-request')
      await readerRequest.locator('summary').click()
      await expect(readerRequest.getByText(d.intake.readOnly)).toBeVisible()
      await expect(
        readerRequest.getByText(p.requestHint, { exact: true }),
      ).toHaveCount(0)
      await expect(readerPage.getByRole('button')).toHaveCount(0)
      await expect(
        readerPage
          .getByTestId('payout-list')
          .locator('.intake-notice', { hasText: p.statuses.approved }),
      ).toHaveCount(1)
    } finally {
      await reader.close()
    }
  } finally {
    await f.close()
  }
})

// The payout list is the newest 50 payouts for any seller; its names must not
// depend on the request form's first 50 sellers by name.
test('a payout for a seller beyond the first fifty names shows the name, not an id', async ({
  page,
}) => {
  const email = `payouts-names-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    // 55 sellers whose names sort before "Synthetic P2 seller" push the fixture seller out of the first 50.
    for (let n = 0; n < 55; n++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'AAA Early seller ' + String(n).padStart(2, '0'),
        '',
        '07000000' + String(n).padStart(2, '0'),
      ])
    const items = [
      await f.item('Names sold one'),
      await f.item('Names sold two'),
    ]
    await f.db.query(
      "select record_sale($1,$2,'manual','NAMES-1',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify(items.map((itemId) => ({ itemId, priceOre: 20000 }))),
      ],
    )
    await f.db.query('select request_payout($1,$2,$3,16000)', [
      f.tenant,
      randomUUID(),
      f.seller,
    ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/payouts')
    const list = page.getByTestId('payout-list')
    const card = list.locator('.intake-notice', {
      hasText: p.statuses.requested,
    })
    await expect(card).toHaveCount(1)
    await expect(
      card.getByRole('link', { name: 'Synthetic P2 seller', exact: true }),
    ).toHaveAttribute('href', `/intake/sellers/${f.seller}`)
    await expect(card).not.toContainText(f.seller)
    // The request form's bounded list is the first 50 by name, none of them with credit.
    const request = page.getByTestId('payout-request')
    await request.locator('summary').click()
    await expect(request.getByRole('status')).toHaveText(p.requestNone)
    await expect(
      request.getByRole('link', { name: p.directory, exact: true }),
    ).toHaveAttribute('href', '/intake/sellers')
  } finally {
    await f.close()
  }
})
