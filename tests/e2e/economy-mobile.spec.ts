import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }

const tags: Record<string, string> = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}
function expectedFormat(locale: string) {
  return {
    money: (ore: number, currency: string) =>
      new Intl.NumberFormat(tags[locale], {
        style: 'currency',
        currency,
      }).format(ore / 100),
    date: (iso: string) =>
      new Intl.DateTimeFormat(tags[locale], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(`${iso}T00:00:00Z`)),
  }
}

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
    await expect(
      totals.getByText('200,00 kr', { exact: true }).first(),
    ).toBeVisible()
    await page
      .getByRole('tab', { name: sv.economy.tabs.overview, exact: true })
      .click()
    await expect(
      page.getByRole('region', {
        name: sv.economy.liabilityHeading,
        exact: true,
      }),
    ).toContainText('80,00 kr')
    await expect(brief).not.toBeVisible()
    const totalsTop =
      (await totals.boundingBox())!.y +
      (await page.evaluate(() => window.scrollY))
    expect(totalsTop).toBeLessThan(900)
    await page.screenshot({
      path: testInfo.outputPath('economy-mobile.png'),
      fullPage: true,
    })
    const payoutsLink = page.locator(
      '#economy-overview a[href="/intake/payouts"]',
    )
    await payoutsLink.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const linkBounds = (await payoutsLink.boundingBox())!
    expect(linkBounds.y + linkBounds.height).toBeLessThan(640)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: testInfo.outputPath('economy-overview-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 720 })
    const details = page.getByTestId('economy-details')
    await expect(details).not.toBeVisible()
    await expect(
      page.locator('#economy-overview a[href="/intake/payouts"]'),
    ).toHaveCount(1)
    await page
      .getByRole('tab', { name: sv.economy.details, exact: true })
      .click()
    await expect(details).toBeVisible()
    await expect(details.locator('summary')).toHaveCount(0)
    await expect(
      details.getByRole('row', {
        name: sv.economy.gross + ' 200,00 kr',
        exact: true,
      }),
    ).toBeVisible()
    await expect(details).not.toContainText(' · ')
    // Bookmark and refresh retain the amounts tab and its period filter.
    await page.reload()
    await expect(
      page.getByRole('tab', { name: sv.economy.details, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel(sv.economy.from, { exact: true }).fill('2025-02-30')
    await page
      .getByRole('button', { name: sv.economy.show, exact: true })
      .click()
    await expect(
      page.getByLabel(sv.economy.from, { exact: true }),
    ).toHaveJSProperty('validationMessage', sv.economy.dateInvalid)
    await expect(page).toHaveURL(
      /from=2025-03-01&to=2025-03-31#economy-amounts$/,
    )
    await page.getByLabel(sv.economy.from, { exact: true }).fill('2025-03-01')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: testInfo.outputPath('economy-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 720 })
    const breakdown = page.getByRole('group', {
      name: sv.economy.perMode,
      exact: true,
    })
    await breakdown.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => breakdown.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0)
    await page
      .getByRole('tab', { name: sv.economy.tabs.reports, exact: true })
      .click()
    await page.screenshot({
      path: testInfo.outputPath('economy-reports-mobile.png'),
      fullPage: true,
    })
    await brief.getByRole('link', { name: sv.brief.month, exact: true }).click()
    await expect(page).toHaveURL(
      /from=2025-03-01&to=2025-03-31&brief=month#economy-brief$/,
    )
    await expect(brief).toBeVisible()
    await page
      .getByRole('tab', { name: sv.economy.tabs.overview, exact: true })
      .click()
    await expect(totals).toContainText('200,00 kr')
    await page.getByLabel(sv.economy.from, { exact: true }).fill('2025-04-01')
    await page.getByLabel(sv.economy.to, { exact: true }).fill('2025-04-30')
    await page
      .getByRole('button', { name: sv.economy.show, exact: true })
      .click()
    await expect(page.getByLabel(sv.economy.from, { exact: true })).toHaveValue(
      '2025-04-01',
    )
    await page
      .getByRole('tab', { name: sv.economy.tabs.reports, exact: true })
      .click()
    await expect(
      brief.getByRole('link', { name: sv.brief.month, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await page
      .getByRole('tab', { name: sv.economy.tabs.days, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: sv.economy.daysHeading, exact: true }),
    ).toContainText(sv.economy.noSales)
    await page
      .getByRole('tab', { name: sv.economy.tabs.overview, exact: true })
      .click()
    await expect(
      page.getByRole('region', {
        name: sv.economy.liabilityHeading,
        exact: true,
      }),
    ).toContainText('80,00 kr')
    await page
      .getByRole('tab', { name: sv.economy.tabs.reports, exact: true })
      .click()
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
            url: new URL(page.url()).origin,
          },
        ])
        await page.goto('/intake/economy?from=2025-03-01&to=2025-03-31')
        await expect(
          page.getByRole('region', {
            name: d.economy.totalsHeading,
            exact: true,
          }),
        ).toContainText(expectedFormat(locale).money(20000, 'SEK'))
        await expect(
          page.getByText(d.economy.intro, { exact: true }),
        ).not.toBeVisible()
        const fmt = expectedFormat(locale)
        await expect(
          page.getByLabel(d.economy.from, { exact: true }),
        ).toHaveValue(fmt.date('2025-03-01'))
        await page
          .getByRole('tab', { name: d.economy.tabs.days, exact: true })
          .click()
        await expect(page.locator('#economy-days')).toContainText(
          fmt.date('2025-03-15'),
        )
        await page
          .getByRole('tab', { name: d.economy.details, exact: true })
          .click()
        await expect(page.getByTestId('economy-details')).toContainText(
          d.economy.vatModes.consignment_margin,
        )
        await page
          .getByLabel(d.economy.from, { exact: true })
          .fill(fmt.date('2025-04-01'))
        await page
          .getByLabel(d.economy.to, { exact: true })
          .fill(fmt.date('2025-04-30'))
        await page
          .getByRole('button', { name: d.economy.show, exact: true })
          .click()
        await expect(page).toHaveURL(
          /from=2025-04-01&to=2025-04-30#economy-amounts$/,
        )
        await expect(page.getByTestId('economy-details')).toBeVisible()
        await page
          .getByRole('tab', { name: d.economy.tabs.reports, exact: true })
          .click()
        await expect(page.locator('.economy-report-options > li')).toHaveCount(
          2,
        )
        await expect(page.locator('.economy-report-options')).toContainText(
          d.economy.weekHint,
        )
        await expect(page.locator('.economy-report-options')).toHaveCSS(
          'list-style-type',
          'disc',
        )
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
