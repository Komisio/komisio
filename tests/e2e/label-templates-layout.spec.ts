import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '@/lib/i18n'

// The printing settings tab on a 320px phone in every language: the template
// editor must not push the page sideways, and every field and action must be
// reachable. Reading and typing only: no preview render, no print job.
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const

test('the label template editor fits a 320px phone in every language and keeps two columns on a desktop', async ({
  page,
}, testInfo) => {
  const email = `label-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    for (const locale of locales) {
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
        await page.goto('/settings?tab=printing')
        const fold = page.locator('details.label-templates-fold')
        const summary = fold.locator('summary')
        const editor = page.locator('.intake-grid').filter({
          has: page.locator('textarea[id^="template-zpl-"]'),
        })
        const zpl = editor.locator('textarea[id^="template-zpl-"]')
        // Occasional configuration stays folded below the recent print jobs.
        await expect(fold).not.toHaveAttribute('open', '')
        await expect(zpl).toBeHidden()
        await expect(page.locator('.label-format-kind').first()).toBeHidden()
        const sizes = page.locator('.label-formats-fold > summary')
        await expect(sizes).toHaveText(d.printing.formatsHeading)
        await expect(
          page.getByRole('heading', { name: d.printing.jobs, exact: true }),
        ).toBeVisible()
        expect((await sizes.boundingBox())!.y).toBeGreaterThan(
          (await page.locator('#print-jobs').boundingBox())!.y,
        )
        await expect(summary).toHaveText(d.printing.templatesHeading)
        expect(
          (await summary.boundingBox())!.height,
          `${locale} summary height`,
        ).toBeGreaterThanOrEqual(44)
        await page.screenshot({
          path: testInfo.outputPath(`printing-320-${locale}-closed.png`),
          fullPage: true,
          caret: 'initial',
        })
        if (locale === 'sv')
          await page.screenshot({
            path: 'private/printing-320-closed.png',
            fullPage: true,
            caret: 'initial',
          })
        // Keyboard opens it: Enter for half the languages, Space for the rest.
        await summary.focus()
        await expect(summary).toBeFocused()
        await page.keyboard.press(
          locales.indexOf(locale) % 2 === 0 ? 'Enter' : 'Space',
        )
        await expect(fold).toHaveAttribute('open', '')
        await expect(zpl).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${locale} page width`,
        ).toBe(true)
        // Every control of the editor lies inside the viewport, unclipped.
        const controls = [
          zpl,
          editor.locator('input[id^="template-name-"]'),
          ...(await editor.locator('.row.wrap button').all()),
          ...(await editor.locator('code').all()),
        ]
        expect(controls.length, `${locale} controls`).toBeGreaterThanOrEqual(8)
        for (const control of controls) {
          const box = (await control.boundingBox())!
          expect(box.x, `${locale} left`).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, `${locale} right`).toBeLessThanOrEqual(320)
          expect(
            await control.evaluate((el) => {
              // Inline code has clientWidth 0 in Firefox; measure its text
              // fragments against their parent instead of a block scrollbox.
              if (getComputedStyle(el).display === 'inline') {
                const text = document.createRange()
                text.selectNodeContents(el)
                const parent = el.parentElement!.getBoundingClientRect()
                return [...text.getClientRects()].every(
                  (rect) =>
                    rect.left >= parent.left - 1 &&
                    rect.right <= parent.right + 1,
                )
              }
              return (
                el.scrollWidth <= el.clientWidth + 1 ||
                el.tagName === 'TEXTAREA'
              )
            }),
            `${locale} clipped text`,
          ).toBe(true)
        }
        for (const name of [d.printing.preview, d.printing.saveTemplate])
          await expect(
            editor.getByRole('button', { name, exact: true }),
          ).toBeVisible()
        // Every label size group (kind, both sizes with their labels, the
        // action) lies inside the viewport without any horizontal scrolling.
        await page.locator('.label-formats-fold > summary').click()
        const groups = await page.locator('.label-format').all()
        expect(groups.length, `${locale} groups`).toBe(5)
        for (const group of groups) {
          for (const control of [
            group.locator('.label-format-kind'),
            group.getByLabel(d.printing.width, { exact: true }),
            group.getByLabel(d.printing.height, { exact: true }),
            group.getByRole('button', {
              name: d.printing.saveFormat,
              exact: true,
            }),
          ]) {
            const box = (await control.boundingBox())!
            expect(box.x, `${locale} size left`).toBeGreaterThanOrEqual(0)
            expect(
              box.x + box.width,
              `${locale} size right`,
            ).toBeLessThanOrEqual(320)
          }
        }
        // A keyboard follows the visible width, height, save order without
        // visiting a duplicate hidden mobile or desktop form.
        const firstGroup = page.locator('.label-format').first()
        await firstGroup.getByLabel(d.printing.width, { exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(
          firstGroup.getByLabel(d.printing.height, { exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(
          firstGroup.getByRole('button', {
            name: d.printing.saveFormat,
            exact: true,
          }),
        ).toBeFocused()
        // Typing reaches the editor; nothing is saved or previewed here.
        await zpl.fill('^XA^FDsynthetic^FS^XZ')
        await expect(zpl).toHaveValue('^XA^FDsynthetic^FS^XZ')
        await page.screenshot({
          path: testInfo.outputPath(`printing-320-${locale}-open.png`),
          fullPage: true,
          caret: 'initial',
        })
        if (locale === 'sv')
          await page.screenshot({
            path: 'private/printing-320-open.png',
            fullPage: true,
            caret: 'initial',
          })
        // Closing and reopening keeps the unsaved text: the editor stays mounted.
        await summary.click()
        await expect(fold).not.toHaveAttribute('open', '')
        await expect(zpl).toBeHidden()
        await summary.click()
        await expect(zpl).toBeVisible()
        await expect(zpl).toHaveValue('^XA^FDsynthetic^FS^XZ')
        await zpl.fill('')
      })
    }
    // Desktop keeps the editor and the preview side by side.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/settings?tab=printing')
    const editor = page.locator('.intake-grid').filter({
      has: page.locator('textarea[id^="template-zpl-"]'),
    })
    await page.locator('details.label-templates-fold summary').click()
    await expect(editor.locator('textarea[id^="template-zpl-"]')).toBeVisible()
    expect(
      await editor.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(2)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.locator('.label-formats-fold > summary').click()
    const sizeGroup = page.locator('.label-format').first()
    await expect(sizeGroup).toBeVisible()
    expect(
      await sizeGroup.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(4)
    const sizes = sizeGroup.locator('input')
    const widthBox = (await sizes.nth(0).boundingBox())!
    const heightBox = (await sizes.nth(1).boundingBox())!
    expect(Math.abs(widthBox.y - heightBox.y)).toBeLessThanOrEqual(1)
    expect(heightBox.x).toBeGreaterThan(widthBox.x + widthBox.width)
    // No label was queued by any of the above.
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
