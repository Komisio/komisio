import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { expectDetailTarget } from '../helpers/detail-target'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'

for (const locale of [
  'sv',
  'en',
  'no',
  'dk',
  'fi',
  'de',
  'es',
  'it',
] as Locale[]) {
  test(`received bags keep readable rows, filters and separate actions (${locale})`, async ({
    page,
  }, info) => {
    const email = `queue-layout-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const d: Dictionary = JSON.parse(
      await readFile(`messages/${locale}.json`, 'utf8'),
    )
    const sellerName = 'Synthetic Alexandersson-Lindgren'
    try {
      const seller = (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          f.tenant,
          randomUUID(),
          sellerName,
          '',
          '0701234567',
        ])
      ).rows[0].id
      const bags: string[] = []
      for (let index = 0; index < 2; index++) {
        bags.push(
          (
            await f.db.query(
              'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
              [
                f.tenant,
                randomUUID(),
                seller,
                'Synthetic queue layout',
                f.agreement,
              ],
            )
          ).rows[0].id,
        )
      }
      await f.db.query("select set_bag_processing($1,$2,$3,0,'completed','')", [
        f.tenant,
        randomUUID(),
        bags[0],
      ])
      const references = await f.db.query(
        'select id, reference from bag_receipts where tenant_id=$1 and id=any($2::uuid[])',
        [f.tenant, bags],
      )
      const number = (id: string) =>
        `K-${references.rows.find((row: { id: string }) => row.id === id).reference}`
      await f.commit()
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      const queueUrl = `/intake?seller=${seller}#intake-queue`
      await page.goto(queueUrl)
      const language = (await page.locator('html').getAttribute('lang'))!
      const queue = page.locator('#bag-queue')
      const table = queue.getByRole('table', {
        name: d.intake.queue,
        exact: true,
      })
      const rows = table.locator('tbody tr')
      await expect(table).toBeVisible()
      await expect(rows).toHaveCount(2)
      await expect(queue.getByRole('heading')).toHaveCount(0)
      await expect(table.getByRole('columnheader')).toHaveText(
        Object.values(d.intake.queueColumns),
      )
      await expect(rows.locator('strong')).toHaveText([
        number(bags[1]),
        number(bags[0]),
      ])
      await expectDetailTarget(
        rows
          .first()
          .getByRole('link', { name: d.intake.queueReview, exact: true }),
        `/intake/bags/${bags[1]}/inspect`,
      )
      await expectDetailTarget(
        rows
          .first()
          .getByRole('link', { name: d.intake.queueLabel, exact: true }),
        `/intake/bags/${bags[1]}`,
      )
      const filters = queue.getByRole('navigation', {
        name: d.intake.queueColumns.status,
        exact: true,
      })
      await expect(filters.locator('[aria-current="page"]')).toHaveText(
        d.handovers.allStatuses,
      )
      await expect(
        queue.getByLabel(d.intake.bagSearch, { exact: true }),
      ).toHaveAttribute('placeholder', 'K-123')
      await expect(rows.first().locator('.received-bag-status')).toHaveText(
        d.bagProcessing.open,
      )
      await expect(rows.last().locator('.received-bag-status')).toHaveText(
        d.bagProcessing.completed,
      )
      const colors = await rows
        .locator('.received-bag-status')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            const luminance = (color: string) => {
              const rgb = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((value) => {
                  const channel = value / 255
                  return channel <= 0.04045
                    ? channel / 12.92
                    : ((channel + 0.055) / 1.055) ** 2.4
                })
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
            }
            const fg = luminance(style.color)
            const bg = luminance(style.backgroundColor)
            return {
              background: style.backgroundColor,
              contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
            }
          }),
        )
      expect(colors[0].background).not.toBe(colors[1].background)
      for (const color of colors)
        expect(color.contrast).toBeGreaterThanOrEqual(4.5)
      for (const width of [1920, 1024, 390, 320]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 1200 : 1000,
        })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width)
        for (const row of await rows.all()) {
          await expect(row.getByText(sellerName, { exact: true })).toBeVisible()
          await expect(row.locator('time')).toBeVisible()
          await expect(row.locator('time')).toHaveAttribute(
            'datetime',
            /^\d{4}-\d{2}-\d{2}T/,
          )
          const received = new Date(
            (await row.locator('time').getAttribute('datetime'))!,
          )
          await expect(row.locator('time')).toContainText(
            new Intl.DateTimeFormat(language, {
              timeZone: 'Europe/Stockholm',
              timeStyle: 'short',
            }).format(received),
          )
          await expect(row.locator('.received-bag-status')).toBeVisible()
          for (const link of await row.getByRole('link').all()) {
            await expect(link).toBeVisible()
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(
              44,
            )
          }
        }
        for (const filter of await filters.getByRole('link').all())
          expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          )
        const geometry = await table.evaluate((element) => {
          const container = element.closest('.compact-directory')!
          const card = element.closest('.received-bags')!
          const overview = element.closest('.intake-overview')!
          return {
            table: element.getBoundingClientRect().width,
            container: container.clientWidth,
            card: card.getBoundingClientRect().width,
            overview: overview.getBoundingClientRect().width,
            rowDisplay: getComputedStyle(element.querySelector('tbody tr')!)
              .display,
          }
        })
        expect(geometry.table).toBeCloseTo(geometry.container, 0)
        expect(geometry.card).toBeCloseTo(geometry.overview, 0)
        expect(geometry.rowDisplay).toBe(width === 1920 ? 'table-row' : 'flex')
        if (locale === 'sv' && [1920, 390].includes(width))
          await page.screenshot({
            path: info.outputPath(`received-bags-${width}.png`),
            fullPage: true,
            caret: 'initial',
          })
      }
      // The label is independent of the row's review target; keyboard follows real links.
      await rows
        .first()
        .getByRole('link', { name: d.intake.queueLabel, exact: true })
        .click()
      await expect(page).toHaveURL(
        (url) => url.pathname === `/intake/bags/${bags[1]}`,
      )
      await page.goto(queueUrl)
      const review = rows
        .first()
        .getByRole('link', { name: d.intake.queueReview, exact: true })
      await review.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(
        (url) => url.pathname === `/intake/bags/${bags[1]}/inspect`,
      )
      await page.goto(queueUrl)
      const cell = rows.first().getByText(sellerName, { exact: true })
      if (info.project.use.hasTouch) await cell.tap()
      else await cell.click()
      await expect(page).toHaveURL(
        (url) => url.pathname === `/intake/bags/${bags[1]}/inspect`,
      )
      await page.goto(queueUrl)
      await filters
        .getByRole('link', { name: d.bagProcessing.completed, exact: true })
        .click()
      await expect(rows).toHaveCount(1)
      await expect(rows.locator('strong')).toHaveText(number(bags[0]))
      await expect(filters.locator('[aria-current="page"]')).toHaveText(
        d.bagProcessing.completed,
      )
      expect(new URL(page.url()).searchParams.get('seller')).toBe(seller)
      await queue
        .getByLabel(d.intake.bagSearch, { exact: true })
        .fill(number(bags[0]))
      await queue
        .getByRole('button', { name: d.intake.searchButton, exact: true })
        .click()
      await expect(rows).toHaveCount(1)
      await expect(page).toHaveURL(new RegExp(`bag=${number(bags[0])}`))
      expect(new URL(page.url()).searchParams.get('state')).toBe('completed')
      await filters
        .getByRole('link', { name: d.bagProcessing.open, exact: true })
        .click()
      await expect(rows).toHaveCount(0)
      await expect(
        queue.getByText(d.intake.noMatchingBags, { exact: true }),
      ).toBeVisible()
      expect(new URL(page.url()).searchParams.get('bag')).toBe(
        number(bags[0]).slice(2),
      )
      await queue
        .getByRole('link', { name: d.intake.clearBagSearch, exact: true })
        .click()
      await expect(rows.locator('strong')).toHaveText(number(bags[1]))
      expect(new URL(page.url()).searchParams.get('seller')).toBe(seller)
    } finally {
      await f.close()
    }
  })
}
