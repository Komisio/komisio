import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }

test('mobile economy puts period totals before the brief and keeps the selected dates', async ({
  page,
}, testInfo) => {
  const email = `economy-mobile-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Historical economy item')
    await f.db.query(
      "select record_sale($1,$2,'manual','ECONOMY-MOBILE','2025-03-15T12:00:00Z'::timestamptz,'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/economy?from=2025-03-01&to=2025-03-31')
    const totals = page.getByRole('region', {
      name: sv.economy.totalsHeading,
      exact: true,
    })
    const brief = page.getByTestId('economy-brief')
    await expect(totals).toContainText('200.00 SEK')
    await expect(brief).not.toHaveAttribute('open', '')
    const totalsTop =
      (await totals.boundingBox())!.y +
      (await page.evaluate(() => window.scrollY))
    expect(totalsTop).toBeLessThan(900)
    expect(totalsTop).toBeLessThan(
      (await brief.boundingBox())!.y +
        (await page.evaluate(() => window.scrollY)),
    )
    await page.screenshot({
      path: testInfo.outputPath('economy-mobile.png'),
      fullPage: true,
    })
    const breakdown = page.getByRole('group', {
      name: sv.economy.perMode,
      exact: true,
    })
    await breakdown.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => breakdown.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0)
    await brief.locator('summary').click()
    await brief.getByRole('link', { name: sv.brief.month, exact: true }).click()
    await expect(page).toHaveURL(
      /from=2025-03-01&to=2025-03-31&brief=month#economy-brief$/,
    )
    await expect(brief).toHaveAttribute('open', '')
    await expect(totals).toContainText('200.00 SEK')
    await page.getByLabel(sv.economy.from, { exact: true }).fill('2025-04-01')
    await page.getByLabel(sv.economy.to, { exact: true }).fill('2025-04-30')
    await page
      .getByRole('button', { name: sv.economy.show, exact: true })
      .click()
    await expect(page.getByLabel(sv.economy.from, { exact: true })).toHaveValue(
      '2025-04-01',
    )
    await expect(
      brief.getByRole('link', { name: sv.brief.month, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      page.getByRole('region', { name: sv.economy.daysHeading, exact: true }),
    ).toContainText(sv.economy.noSales)
    await brief.getByRole('link', { name: sv.brief.week, exact: true }).click()
    await expect(page).toHaveURL(
      /from=2025-04-01&to=2025-04-30&brief=week#economy-brief$/,
    )
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
        await page.goto('/intake/economy?from=2025-03-01&to=2025-03-31')
        await expect(
          page.getByRole('region', {
            name: d.economy.totalsHeading,
            exact: true,
          }),
        ).toContainText('200.00 SEK')
        await expect(
          page.getByText(d.economy.intro, { exact: true }),
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      })
    }
  } finally {
    await f.close()
  }
})
