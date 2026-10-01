import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('context help preserves edits, traps focus on mobile and has a protected article route', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const email = `help-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const guide = page.locator('.fortnox-guide')
    await expect(guide).toContainText(d.helpCenter.guide.title)
    await expect(
      guide.getByText(d.helpCenter.guide.states.unknown, { exact: true }),
    ).toHaveCount(0)
    const account = page.locator('#account-map input').first()
    await account.fill('1930')
    const open = page.getByRole('button', {
      name: d.helpCenter.title,
      exact: true,
    })
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('help-desktop.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(open).toBeFocused()
    await expect(account).toHaveValue('1930')
    await page.setViewportSize({ width: 390, height: 844 })
    await open.click()
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds?.width).toBe(390)
    expect(bounds?.height).toBe(844)
    await page.screenshot({ path: testInfo.outputPath('help-mobile.png') })
    await page.keyboard.press('Shift+Tab')
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true)
    await page.keyboard.press('Tab')
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await dialog.getByRole('button', { name: d.helpCenter.close }).click()
    await expect(account).toHaveValue('1930')
    await page.setViewportSize({ width: 320, height: 740 })
    await open.click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    const articlePromise = page.waitForEvent('popup')
    await dialog.getByRole('link', { name: d.helpCenter.fullArticle }).click()
    const article = await articlePromise
    await expect(article).toHaveURL(/\/help\/fortnox-connect$/)
    await expect(article.getByRole('heading', { level: 1 })).toHaveText(
      d.helpCenter.articles['fortnox-connect'].title,
    )
    await article.close()
    await expect(account).toHaveValue('1930')
    await page.keyboard.press('Escape')
    let automationWrites = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/automation-grants'
      )
        automationWrites++
    })
    const automationHelp = page.getByRole('button', {
      name: d.helpCenter.articles['fortnox-automation'].title,
      exact: true,
    })
    await automationHelp.click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      d.helpCenter.articles['fortnox-automation'].title,
    )
    await expect(dialog).toContainText(
      d.helpCenter.articles['fortnox-automation'].notice,
    )
    await expect(
      dialog.getByRole('link', { name: d.helpCenter.settings, exact: true }),
    ).toHaveAttribute(
      'href',
      '/intake/accounting?view=settings#fortnox-automation',
    )
    await expect(
      dialog.getByRole('link', {
        name: d.helpCenter.articles['fortnox-recovery'].title,
        exact: true,
      }),
    ).toHaveAttribute('href', '/help/fortnox-recovery')
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.keyboard.press('Escape')
    await expect(automationHelp).toBeFocused()
    await expect(account).toHaveValue('1930')
    expect(automationWrites).toBe(0)
    await page.goto('/help')
    await page
      .getByRole('link', {
        name: d.helpCenter.articles['fortnox-automation'].title,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(/\/help\/fortnox-automation$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      d.helpCenter.articles['fortnox-automation'].title,
    )
    // Next returns 200 for streamed notFound responses; assert the actual fallback.
    await page.goto('/help/not-a-topic')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(d.notFound)
    const anonymous = await browser.newContext()
    try {
      const guest = await anonymous.newPage()
      await guest.goto('http://127.0.0.1:3000/help/fortnox-connect')
      await expect(guest).toHaveURL(/\/login/)
    } finally {
      await anonymous.close()
    }
  } finally {
    await f.close()
  }
})

test('a lost send response offers reconciliation help without another send', async ({
  page,
}) => {
  const email = `help-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic help item')
    const close = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-03-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.db.query("select generate_day_close($1,$2,'2020-03-02')", [
      f.tenant,
      close,
    ])
    await f.db.query('select publish_accounting_map($1,$2,null,$3::jsonb)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({
        grossOre: { account: '1930', side: 'debit' },
        commissionOre: { account: '3010', side: 'credit' },
        sellerCreditOre: { account: '2890', side: 'credit' },
      }),
    ])
    await f.db.query('select export_day_close($1,$2,$3)', [
      f.tenant,
      randomUUID(),
      close,
    ])
    await f.db.query(
      "select store_fortnox_connection($1,'1751085','Synthetic help company','',$2::jsonb,'bookkeeping',now()+interval '1 hour')",
      [f.tenant, JSON.stringify({ iv: 'aWl2', tag: 'dGFn', data: 'ZGF0YQ==' })],
    )
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const guide = page.locator('.fortnox-guide')
    await expect(
      guide
        .locator('li')
        .filter({ hasText: d.helpCenter.guide.steps.exported }),
    ).toContainText(d.helpCenter.guide.states.done)
    await expect(
      guide.getByText(d.helpCenter.guide.states.unknown, { exact: true }),
    ).toHaveCount(0)
    await page.goto('/intake/accounting')
    let sends = 0
    await page.route('**/api/integrations/fortnox', async (route) => {
      if (route.request().postDataJSON()?.action !== 'sendVoucher')
        return route.continue()
      sends++
      // The engine records a preflight failure locally; the browser cannot know it.
      await route.fetch()
      await route.abort('failed')
    })
    const exports = page.getByRole('region', {
      name: d.accounting.exportsHeading,
      exact: true,
    })
    await exports
      .getByRole('button', { name: d.fortnox.sendVoucher, exact: true })
      .click()
    await expect(exports.getByRole('alert')).toContainText(
      d.fortnox.voucherUnknown,
    )
    await expect(
      exports.getByRole('button', { name: d.fortnox.sendAgain, exact: true }),
    ).toHaveCount(0)
    await exports.getByRole('link', { name: d.fortnox.recoveryHelp }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      d.helpCenter.articles['fortnox-recovery'].title,
    )
    expect(sends).toBe(1)
    await page.goto('/intake/accounting')
    await expect(exports.getByRole('alert')).toContainText(
      d.fortnox.errors.FORTNOX_PREFLIGHT_FAILED,
    )
    await expect(
      exports.getByRole('button', { name: d.fortnox.sendAgain, exact: true }),
    ).toBeVisible()
    expect(sends).toBe(1)
  } finally {
    await f.close()
  }
})
