import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import sv from '../../messages/sv.json' with { type: 'json' }

// The seller portal on a phone with a small but realistic history: one
// requested payout, five ledger entries, one statement, no items, handovers
// or messages. Balance, shortcuts, payout request, payouts and statements stay
// in plain view; the ledger and message history fold behind native summaries
// that still carry the heading and the count. Nothing is paid or sent.
test('compact seller portal keeps money facts visible and folds only secondary history', async ({
  page,
}, testInfo) => {
  const email = `seller-compact-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  try {
    const owner = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `compact-staff-${owner}@example.test`],
    )
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Compact portal',
        `compact-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id as string
    const seller = (
      await db.query('select register_seller($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        'Synthetic seller',
        email,
        '',
      ])
    ).rows[0].id as string
    for (const ore of [20000, 5000, -1000, 3000, 2000])
      await db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
        tenant,
        randomUUID(),
        seller,
        ore,
        'Synthetic compact fixture',
      ])
    await db.query('select request_payout($1,$2,$3,$4)', [
      tenant,
      randomUUID(),
      seller,
      10000,
    ])
    await db.query(
      "select issue_statement($1,$2,$3,'2000-01-01',clock_timestamp())",
      [tenant, randomUUID(), seller],
    )
    await db.query('commit')
    const url = `/seller?seller=${seller}`
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(url)
    await expect(
      page.getByRole('heading', { name: /Tillg.*290/ }),
    ).toBeVisible()
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    )
    testInfo.annotations.push({
      type: 'document-height-320',
      description: String(height),
    })
    console.log(`seller portal document height at 320px: ${height}`)
    await page.screenshot({
      path: testInfo.outputPath('seller-portal-compact-320.png'),
      fullPage: true,
      caret: 'initial',
    })
    // Money facts and actions stay in plain view.
    const portal = page.locator('main')
    await expect(
      portal.getByRole('heading', {
        name: sv.sellerPortal.payouts,
        exact: true,
      }),
    ).toBeVisible()
    await expect(portal.getByText(/begärd/)).toBeVisible()
    await expect(page.locator('#portal-statements h2')).toBeVisible()
    await expect(page.locator('#portal-payout-request h2')).toBeVisible()
    // Secondary history is folded with heading and count in the summary.
    const ledger = page.getByTestId('portal-ledger')
    const messages = page.getByTestId('portal-messages')
    await expect(ledger).not.toHaveAttribute('open', '')
    await expect(ledger.locator('summary')).toContainText(
      sv.sellerPortal.ledger,
    )
    await expect(ledger.locator('summary')).toContainText('5')
    await expect(messages).not.toHaveAttribute('open', '')
    await expect(messages.locator('summary')).toContainText(
      sv.sellerPortal.messages,
    )
    await expect(messages.locator('summary')).toContainText('0')
    // The per-list limit notice stays next to the whole history, not inside one fold.
    await expect(
      page.getByText(sv.sellerPortal.recent, { exact: true }),
    ).toBeVisible()
    // Keyboard: the summary is focusable and Enter opens and closes it.
    await ledger.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(ledger).toHaveAttribute('open', '')
    await expect(ledger.getByText(/-10\.00 SEK/)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(ledger).not.toHaveAttribute('open', '')
    // Eight languages: no horizontal overflow, folds still labelled.
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      await test.step(locale, async () => {
        const d: Dictionary = JSON.parse(
          readFileSync(
            new URL(`../../messages/${locale}.json`, import.meta.url),
            'utf8',
          ),
        )
        await page.context().addCookies([
          {
            name: 'komisio-locale',
            value: locale,
            url: 'http://127.0.0.1:3000',
          },
        ])
        await page.goto(url)
        await expect(
          page.getByTestId('portal-ledger').locator('summary'),
        ).toContainText(d.sellerPortal.ledger)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      })
    }
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])
    // Leave the page so the next goto is a full load in Swedish, not a
    // same-document hash change of the Italian page.
    await page.goto('/seller')
    // Hash navigation and the items section are untouched.
    await page.goto(url + '#portal-items')
    await expect(page.locator('#portal-items h2')).toBeInViewport()
    await page.goto(url + '#portal-statements')
    await expect(page.locator('#portal-statements h2')).toBeInViewport()
    // The statement deep link and its way back still work.
    await page
      .getByRole('link', { name: `${sv.sellerPortal.open} #1`, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: `${sv.sellerPortal.statements} #1` }),
    ).toBeVisible()
    await page
      .getByRole('link', { name: 'Compact portal', exact: true })
      .click()
    await expect(page).toHaveURL(/#portal-statements$/)
    await expect(page.locator('#portal-statements h2')).toBeInViewport()
  } finally {
    await db.end()
  }
})
