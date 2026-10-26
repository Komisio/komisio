import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'
import sv from '../../messages/sv.json' with { type: 'json' }

// Synthetic balances and message history exercise the four task tabs.
test('seller portal tabs retain drafts, bookmarks and localized mobile navigation', async ({
  page,
}, testInfo) => {
  const email = `seller-compact-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
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
      page.getByRole('heading', { name: 'Compact portal', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(4)
    await expect(
      page.getByRole('tab', { name: sv.sellerPortal.items, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('portal-ledger')).toHaveCount(0)
    await expect(page.locator('.seller-portal-shortcuts')).toHaveCount(0)
    await expect(page.locator('#portal-statements')).toHaveCount(0)
    await page
      .getByRole('tab', { name: sv.sellerPortal.payouts, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: /Tillg.*290/ }),
    ).toBeVisible()
    await expect(page.getByText(/begärd/)).toBeVisible()
    const amount = page.getByLabel(
      sv.sellerPortal.amount.replace('{currency}', 'SEK'),
      { exact: true },
    )
    await amount.fill('120')
    await page
      .getByRole('tab', { name: sv.sellerPortalWorkspace.details, exact: true })
      .click()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0)
    await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute(
      'content',
      /email=no/,
    )
    const messages = page.getByTestId('portal-messages')
    await expect(messages).not.toHaveAttribute('open', '')
    await expect(messages.locator('summary')).toContainText(
      sv.sellerPortal.messages,
    )
    await expect(messages.locator('summary')).toContainText('0')
    await messages.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(messages).toHaveAttribute('open', '')
    await page
      .getByRole('tab', { name: sv.sellerPortal.payouts, exact: true })
      .click()
    await expect(amount).toHaveValue('120')
    await page
      .getByRole('tab', { name: sv.sellerPortal.payouts, exact: true })
      .focus()
    await page.keyboard.press('ArrowRight')
    await expect(
      page.getByRole('tab', {
        name: sv.sellerPortalWorkspace.details,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({
      path: testInfo.outputPath('seller-details-320.png'),
      fullPage: true,
    })
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
        readFileSync(
          new URL('../../messages/' + locale + '.json', import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      await page.reload()
      for (const [id, label] of [
        ['items', d.sellerPortal.items],
        ['payouts', d.sellerPortal.payouts],
        ['details', d.sellerPortalWorkspace.details],
        ['agreement', d.sellerPortalWorkspace.agreement],
      ]) {
        const tab = page.getByRole('tab', { name: label, exact: true })
        await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (locale === 'sv') {
          await page.reload()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
        }
        await expect(page).toHaveURL(
          new RegExp('#seller-workspace-' + id + '$'),
        )
      }
      await expect(
        page.getByText(d.sellerPortalWorkspace.noAgreement, { exact: true }),
      ).toBeVisible()
    }
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'sv',
        url: new URL(page.url()).origin,
      },
    ])
    await page.goto(url + '#portal-items')
    await page.reload()
    await expect(page.getByRole('tab').first()).toBeEnabled()
    await expect(page.locator('#portal-items h2')).toBeInViewport()
    await page.goto(url + '#portal-payout-request')
    await expect(page.locator('#portal-payout-request h2')).toBeInViewport()
    await page.goto(url + '#portal-messages')
    await expect(messages.locator('summary')).toBeInViewport()
    // A pending or failed synthetic message remains visible without opening a fold.
    // Use only the local engine log; no delivery transport is invoked.
    const messageId = randomUUID()
    async function asOwner(work: () => Promise<unknown>) {
      await db.query('begin')
      try {
        await db.query('set local role authenticated')
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: owner, role: 'authenticated' }),
        ])
        await work()
        await db.query('commit')
      } catch (error) {
        await db.query('rollback')
        throw error
      }
    }
    await asOwner(() =>
      db.query(
        "select queue_seller_communication($1,$2,$3,'message','message','v1','sv',$4,$5,'none',null)",
        [
          tenant,
          messageId,
          seller,
          'Synthetic portal notice',
          'Synthetic notice body',
        ],
      ),
    )
    await page.reload()
    await expect(messages).toHaveAttribute('open', '')
    await expect(
      messages.getByText('Synthetic notice body', { exact: true }),
    ).toBeVisible()
    await expect(messages).toContainText(sv.communications.outcomes.queued)
    await asOwner(() =>
      db.query("select record_communication_delivery($1,$2,'failed')", [
        tenant,
        messageId,
      ]),
    )
    await page.reload()
    await expect(messages).toHaveAttribute('open', '')
    await expect(messages).toContainText(sv.communications.outcomes.failed)
  } finally {
    await db.query('rollback')
    await db.end()
  }
})
