import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFile } from 'node:fs/promises'
import type { Dictionary } from '../../lib/i18n'
const tags = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}
const locales = Object.keys(tags) as (keyof typeof tags)[]
const intlLocale = (locale: keyof typeof tags) => tags[locale]

async function checkLayout(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1024 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width)
  const rows = page.locator('.compact-directory-table:visible tbody tr')
  const boxes = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect()
      return { height: r.height, bottom: r.bottom }
    }),
  )
  expect(boxes[0].height).toBeGreaterThanOrEqual(44)
  expect(boxes[0].height).toBeLessThanOrEqual(width <= 390 ? 140 : 100)
  if (width === 768)
    expect(
      (await page
        .locator('.compact-directory-table:visible thead')
        .boundingBox())!.width,
    ).toBeGreaterThan(100)
  if (width === 768)
    expect(boxes.filter((r) => r.bottom <= 1024).length).toBeGreaterThanOrEqual(
      4,
    )
  expect(
    await page
      .locator('.compact-directory-table:visible')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  for (const control of await page
    .locator(
      '.directory-filters:visible input:not([type=hidden]),.directory-filters:visible select,.directory-filters:visible button',
    )
    .all()) {
    const b = await control.boundingBox()
    expect(b!.x).toBeGreaterThanOrEqual(0)
    expect(b!.x + b!.width).toBeLessThanOrEqual(width)
    expect(b!.height).toBeGreaterThanOrEqual(44)
  }
}

for (const locale of locales) {
  test(`compact seller and approval directories preserve sorting and filters (${locale})`, async ({
    page,
    baseURL,
  }, info) => {
    const email = `directories-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const d: Dictionary = JSON.parse(
      await readFile(`messages/${locale}.json`, 'utf8'),
    )
    try {
      for (let n = 0; n < 30; n++)
        await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
          f.tenant,
          randomUUID(),
          `A compact ${String(n).padStart(2, '0')}`,
          `long-synthetic-contact-${n}@example.test`,
          '0701234567',
        ])
      const item = await f.item('Synthetic directory jacket')
      await f.db.query(
        "select record_sale($1,$2,'manual',$3,now(),'SEK',$4::jsonb)",
        [
          f.tenant,
          randomUUID(),
          `directory-${randomUUID()}`,
          JSON.stringify([{ itemId: item, priceOre: 20000 }]),
        ],
      )
      await f.commit()
      await f.asActor(f.actor, async () => {
        const later = (
          await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
            f.tenant,
            randomUUID(),
            'Z later approval',
            'later@example.test',
            '',
          ])
        ).rows[0].id
        await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
          f.tenant,
          randomUUID(),
          later,
          f.agreement,
          'Synthetic later paper',
        ])
      })
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.setViewportSize({ width: 1440, height: 1024 })
      await page.goto('/intake/sellers')
      const rows = page.locator('.compact-directory-table tbody tr')
      await expect(rows).toHaveCount(25)
      const sort = page.getByRole('columnheader', {
        name: d.sellersList.available,
        exact: true,
      })
      await sort.getByRole('link').click()
      await expect(sort).toHaveAttribute('aria-sort', 'ascending')
      await sort.getByRole('link').click()
      await expect(sort).toHaveAttribute('aria-sort', 'descending')
      await expect(rows.first()).toContainText('Synthetic P2 seller')
      const money = new Intl.NumberFormat(intlLocale(locale), {
        style: 'currency',
        currency: 'SEK',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(80)
      await expect(rows.first()).toContainText(money)
      await page
        .getByRole('link', { name: d.sellersList.nextPage, exact: true })
        .click()
      await expect(page).toHaveURL(/page=2/)
      expect(new URL(page.url()).searchParams.get('order')).toBe(
        'available:desc',
      )
      await page
        .getByLabel(d.sellersList.search, { exact: true })
        .fill('A compact')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(rows).toHaveCount(25)
      expect(new URL(page.url()).searchParams.has('page')).toBe(false)
      await expect(page.getByLabel(d.directory.sortBy)).toHaveValue(
        'available:desc',
      )
      for (const width of [768, 390, 320, 1024]) await checkLayout(page, width)
      await page.setViewportSize({ width: 768, height: 1024 })
      if (locale === 'sv')
        await page.screenshot({
          path: info.outputPath('sellers-ipad.png'),
          fullPage: false,
        })
      // Pointer on a non-link numeric cell opens the seller; the primary link stays keyboard-native.
      const expected = await rows
        .first()
        .locator('.directory-primary-link')
        .getAttribute('href')
      await rows.first().locator('td').nth(2).click()
      await expect(page).toHaveURL(new URL(expected!, page.url()).href)

      await page.goto('/intake/agreements#agreements-sellers')
      await expect(
        page.getByRole('tab', {
          name: d.agreements.workspace.sellers,
          exact: true,
        }),
      ).toHaveAttribute('aria-selected', 'true')
      await page.getByLabel(d.directory.sortBy).selectOption('date:desc')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(
        page.locator('.compact-directory-table:visible tbody tr').first(),
      ).toContainText('Z later approval')
      await page.getByLabel(d.directory.sortBy).selectOption('date:asc')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(
        page.locator('.compact-directory-table:visible tbody tr').first(),
      ).toContainText('Synthetic P2 seller')
      await page.getByLabel(d.directory.sortBy).selectOption('status:desc')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('order') === 'status:desc',
      )
      const approvals = page.locator(
        '.compact-directory-table:visible tbody tr',
      )
      await expect(approvals).toHaveCount(25)
      await expect(approvals.first()).toContainText('Synthetic P2 seller')
      await expect(approvals.first()).toContainText(d.sellerPortal.staff)
      const time = approvals.first().locator('time')
      const instant = await time.getAttribute('datetime')
      await expect(time).toHaveText(
        new Date(instant!).toLocaleDateString(intlLocale(locale), {
          timeZone: 'Europe/Stockholm',
        }),
      )
      for (const width of [768, 390, 320, 1024]) await checkLayout(page, width)
      await page.setViewportSize({ width: 768, height: 1024 })
      if (locale === 'sv')
        await page.screenshot({
          path: info.outputPath('approvals-ipad.png'),
          fullPage: false,
        })
      await page
        .getByLabel(d.agreements.workspace.status, { exact: true })
        .selectOption('missing')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(approvals).toHaveCount(25)
      await expect(approvals.first()).not.toContainText('Synthetic P2 seller')
      await page
        .getByRole('link', { name: d.agreements.workspace.next, exact: true })
        .click()
      await expect(approvals).toHaveCount(5)
      expect(new URL(page.url()).searchParams.get('order')).toBe('status:desc')
      expect(new URL(page.url()).searchParams.get('status')).toBe('missing')
      await page
        .getByLabel(d.agreements.workspace.search, { exact: true })
        .fill('A compact 29')
      await page.locator('.directory-filters').getByRole('button').click()
      await expect(approvals).toHaveCount(1)
      await expect(approvals).toContainText('A compact 29')
      await approvals.locator('.directory-primary-link').focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/intake\/sellers\/.+#seller-terms/)
    } finally {
      await f.close()
    }
  })
}
