import { test, expect, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
import sv from '../../messages/sv.json' with { type: 'json' }

test('receipt labels expose printing and frozen agreement status in every language', async ({
  page,
}, info) => {
  const email = `intake-label-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const missingSeller = randomUUID()
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      missingSeller,
      'Synthetic optional agreement',
      '',
      '00000000',
    ])
    const bags = [randomUUID(), randomUUID()]
    for (const [index, seller] of [f.seller, missingSeller].entries())
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5)', [
        f.tenant,
        bags[index],
        seller,
        '',
        f.agreement,
      ])
    await f.db.query(
      "select register_printer($1,$2,'Synthetic Zebra','tcp','127.0.0.1:9100','Synthetic',203,true)",
      [f.tenant, randomUUID()],
    )
    await f.commit()
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
        readFileSync(`messages/${locale}.json`, 'utf8'),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      for (const [index, bag] of bags.entries()) {
        await page.setViewportSize({
          width: index === 0 ? 1440 : 320,
          height: 1000,
        })
        await page.goto(`/intake/bags/${bag}`)
        const status =
          index === 0 ? d.agreements.tabApproved : d.agreements.tabMissing
        const tab = page.getByRole('tab', {
          name: `${d.agreements.tabLabel} — ${status}`,
          exact: true,
        })
        await expect(tab).toHaveText(d.agreements.tabLabel)
        await expect(tab).toHaveAttribute(
          'data-status',
          index === 0 ? 'approved' : 'missing',
        )
        await expect(
          tab.locator(
            index === 0 ? 'svg.lucide-check' : 'svg.lucide-triangle-alert',
          ),
        ).toHaveAttribute('aria-hidden', 'true')
        await expect(tab).toHaveCSS(
          'background-color',
          index === 0 ? 'rgb(234, 241, 231)' : 'rgb(255, 240, 237)',
        )
        for (const text of [
          d.intake.label,
          d.intake.labelPreview,
          d.intake.awaiting,
          d.agreements.evidenceHelp,
        ])
          await expect(page.getByText(text, { exact: true })).toHaveCount(0)
        await expect(
          page.getByLabel(d.printing.printer, { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByLabel(d.printing.copies, { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: d.intake.print, exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', {
            name: d.intake.browserPrint,
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          page.getByRole('link', {
            name: d.inspection.title + ' →',
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          page.getByRole('link', {
            name: d.returnNavigation.back,
            exact: true,
          }),
        ).toBeVisible()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(index === 0 ? 1440 : 320)
        await page.getByRole('tab').first().focus()
        await page.getByRole('tab').first().press('ArrowRight')
        await expect(tab).toBeFocused()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
        await expect(
          page.getByRole('heading', {
            name: d.agreements.receiptAgreement,
            exact: true,
          }),
        ).toBeVisible()
        await expect(page.locator('.bag-label-agreement')).toContainText(
          index === 0 ? 'Synthetic paper agreement' : d.agreements.noEvidence,
        )
        if (locale === 'sv') {
          // Browser printing must still show the label from the agreement tab.
          await page.emulateMedia({ media: 'print' })
          await expect(page.locator('.bag-label')).toBeVisible()
          await expect(page.locator('.bag-label-agreement')).toBeHidden()
          await page.emulateMedia({ media: 'screen' })
        }
        await tab.press('Home')
        if (locale === 'sv') {
          await page.screenshot({
            path: info.outputPath(
              `label-${index === 0 ? 'desktop-approved' : 'mobile-missing'}.png`,
            ),
            fullPage: true,
          })
          await page.evaluate(() => {
            window.print = () => {
              document.body.dataset.printed = 'yes'
            }
          })
          await page
            .getByRole('button', { name: d.intake.browserPrint, exact: true })
            .click()
          await expect(page.locator('body')).toHaveAttribute(
            'data-printed',
            'yes',
          )
          await page.emulateMedia({ media: 'print' })
          await expect(page.locator('.bag-label')).toBeVisible()
          await expect(page.getByRole('tablist')).toBeHidden()
          await expect(page.locator('.bag-label-print')).toBeHidden()
          await page.emulateMedia({ media: 'screen' })
        }
      }
    }
  } finally {
    await f.close()
  }
})

for (const [currency, symbol] of [
  ['SEK', 'kr'],
  ['EUR', '€'],
  ['USD', '$'],
]) {
  test(`review uses full width and price fields retain store currency ${currency}`, async ({
    page,
  }, info) => {
    const email = `intake-currency-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.db.query(
        "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || jsonb_build_object('currency',$3::text))",
        [f.tenant, randomUUID(), currency],
      )
      const bag = randomUUID(),
        reception = randomUUID(),
        purchase = randomUUID()
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5)', [
        f.tenant,
        bag,
        f.seller,
        '',
        f.agreement,
      ])
      await f.db.query(
        'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
        [
          f.tenant,
          randomUUID(),
          bag,
          reception,
          'Synthetic review item',
          'Jackets',
          'Good',
        ],
      )
      await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
        f.tenant,
        purchase,
        'Synthetic currency purchase',
        10000,
        'Synthetic evidence',
      ])
      await f.commit()
      const checkPrice = async (input: Locator) => {
        await expect(input).toBeVisible()
        const suffix = page.locator(
          `#${await input.getAttribute('id')}-currency`,
        )
        await expect(suffix).toHaveText(symbol)
        await expect(suffix).toHaveAttribute('aria-label', currency)
        // Agreement loading can move the whole form. Measure both controls
        // in the same frame so that movement is not mistaken for misalignment.
        const geometry = await input.evaluate((element) => {
          const field = element.getBoundingClientRect()
          const currency = document
            .getElementById(`${element.id}-currency`)!
            .getBoundingClientRect()
          return {
            width: field.width,
            gap: currency.left - field.right,
            offset: Math.abs(
              currency.y + currency.height / 2 - field.y - field.height / 2,
            ),
          }
        })
        expect(geometry.width).toBeLessThanOrEqual(160)
        expect(geometry.width).toBeGreaterThanOrEqual(100)
        expect(geometry.gap).toBeGreaterThan(0)
        expect(geometry.offset).toBeLessThan(2)
        await expect(input).toHaveAttribute(
          'aria-describedby',
          new RegExp(`${await input.getAttribute('id')}-currency`),
        )
      }
      for (const width of [1920, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`/intake/bags/${bag}/inspect`)
        await expect(page.getByRole('main')).toHaveClass(/main--wide/)
        await expect(
          page.getByRole('region', { name: sv.bagProgress.title, exact: true }),
        ).toHaveCount(0)
        await checkPrice(page.locator('#quick-price'))
        const widths = await page
          .locator('.bag-reception-page')
          .evaluate((el) => {
            const parent = el.parentElement!,
              style = getComputedStyle(parent)
            return {
              page: el.getBoundingClientRect().width,
              available:
                parent.getBoundingClientRect().width -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight),
              form: el
                .querySelector('.quick-reception')!
                .getBoundingClientRect().width,
            }
          })
        expect(widths.page).toBeCloseTo(widths.available, 0)
        expect(widths.form).toBeCloseTo(widths.page, 0)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
        if (currency === 'EUR')
          await page.screenshot({
            path: info.outputPath(`review-${width}.png`),
            fullPage: true,
          })
      }
      await page.goto('/intake/quick')
      await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
      await checkPrice(page.locator('#quick-price'))
      await page.goto(`/intake/reception/${reception}`)
      const price = page.locator(`#accept-price-${reception}`)
      await checkPrice(price)
      await price.fill('1,234')
      await price.locator('xpath=ancestor::form').getByRole('checkbox').check()
      await price
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: sv.items.accept, exact: true })
        .click()
      await expect(price).toBeFocused()
      await expect(price).toHaveAttribute('aria-invalid', 'true')
      // Clear the intentionally invalid draft before checking the shared purchase form.
      await price.fill('')
      page.once('dialog', (dialog) => dialog.accept())
      await page.goto('/intake/purchases')
      await checkPrice(page.locator(`#accept-price-${purchase}`))
    } finally {
      await f.close()
    }
  })
}
