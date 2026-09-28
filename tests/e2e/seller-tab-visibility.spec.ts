import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

// The seller workspace tabs are one horizontal strip. On a phone a deep link
// or a shortcut can select a tab that sits beyond the strip's visible width;
// the selected tab must then be brought into the strip, without moving the
// page vertically or changing the hash and keyboard behaviour.
const selectedWithinStrip = async (page: Page) => {
  const strip = await page.getByRole('tablist').boundingBox()
  const tab = await page
    .locator('[role="tab"][aria-selected="true"]')
    .boundingBox()
  expect(strip).not.toBeNull()
  expect(tab).not.toBeNull()
  return {
    strip: strip!,
    tab: tab!,
    inside:
      tab!.x >= strip!.x - 0.5 &&
      tab!.x + tab!.width <= strip!.x + strip!.width + 0.5,
  }
}

test('the selected seller tab stays visible inside the tab strip on a phone', async ({
  page,
}, testInfo) => {
  const email = `seller-tabs-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const path = `/intake/sellers/${f.seller}`
    await page.setViewportSize({ width: 320, height: 720 })
    for (const locale of ['sv', 'fi', 'de']) {
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
        // Deep link to the last tab.
        await page.goto('/intake/sellers')
        await page.goto(`${path}#seller-details`)
        const details = page.getByRole('tab', {
          name: d.sellerWorkspace.details,
          exact: true,
        })
        await expect(details).toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('#seller-details')).toBeVisible()
        await expect
          .poll(async () => (await selectedWithinStrip(page)).inside, {
            message: `${locale} deep selected tab inside strip`,
          })
          .toBe(true)
        // The strip itself never widens the page.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
        // Overview shortcut to the economy tab.
        await page.goto('/intake/sellers')
        await page.goto(`${path}#seller-overview`)
        await page
          .locator('#seller-overview a[href="#seller-economy"]')
          .first()
          .click()
        await expect(
          page.getByRole('tab', {
            name: d.sellerWorkspace.economy,
            exact: true,
          }),
        ).toHaveAttribute('aria-selected', 'true')
        await expect(page).toHaveURL(/#seller-economy$/)
        await expect
          .poll(async () => (await selectedWithinStrip(page)).inside, {
            message: `${locale} shortcut selected tab inside strip`,
          })
          .toBe(true)
        if (locale === 'sv')
          await page.screenshot({
            path: testInfo.outputPath('seller-tab-visibility-320.png'),
            fullPage: false,
            caret: 'initial',
          })
      })
    }
    // Clicking a tab button scrolls only the strip, never the page.
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])
    await page.goto('/intake/sellers')
    await page.goto(`${path}#seller-overview`)
    // A short viewport makes both panels taller than the window, so a
    // scrolled position exists on either side of the click; start from one
    // so a jump back to the top would show.
    await page.setViewportSize({ width: 320, height: 400 })
    // Scroll inside the poll: right after a resize the layout may not have
    // grown yet, and a scroll request before that is clamped to zero.
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, 54)
          return window.scrollY
        }),
      )
      .toBe(54)
    const measure = () =>
      page.evaluate(() => ({
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }))
    const before = await measure()
    await page.getByRole('tab').last().click()
    await expect(page.getByRole('tab').last()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect
      .poll(async () => (await selectedWithinStrip(page)).inside)
      .toBe(true)
    const after = await measure()
    // Selecting a tab pushes its hash, which (as before this change) brings
    // the panel into view, and the shorter panel can clamp the scroll
    // position. Neither is a jump back to the top: the page never ends up
    // above where the clamp allows, and the selected panel's top is on
    // screen. Measured identically with the component from main.
    const clampedTo = Math.min(
      before.scrollY,
      Math.max(0, after.scrollHeight - after.innerHeight),
    )
    expect(after.scrollY).toBeGreaterThanOrEqual(clampedTo)
    const panelTop = (await page.locator('#seller-details').boundingBox())!.y
    expect(panelTop).toBeGreaterThanOrEqual(-1)
    expect(panelTop).toBeLessThan(after.innerHeight)
    await page.setViewportSize({ width: 320, height: 720 })
    // Keyboard and hash behaviour are unchanged.
    await page.getByRole('tab').last().focus()
    await page.keyboard.press('Home')
    await expect(page.getByRole('tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page).toHaveURL(/#seller-overview$/)
    await page.keyboard.press('End')
    await expect(page).toHaveURL(/#seller-details$/)
    await expect
      .poll(async () => (await selectedWithinStrip(page)).inside)
      .toBe(true)
    await page.goBack()
    await expect(page).toHaveURL(/#seller-overview$/)
    await expect(page.getByRole('tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Selecting the last tab on a wide screen and then turning the phone or
    // narrowing the window keeps the selected tab in the strip: the selection
    // and the hash do not change, only the width does.
    await page.setViewportSize({ width: 1000, height: 400 })
    await page.getByRole('tab').last().click()
    await expect(page).toHaveURL(/#seller-details$/)
    await expect
      .poll(async () => (await selectedWithinStrip(page)).inside)
      .toBe(true)
    // The width change is the only trigger of the strip's own reveal (no
    // hash navigation is involved), so this isolates its vertical effect:
    // the page must not move except for the browser's height clamp.
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, 40)
          return window.scrollY
        }),
      )
      .toBe(40)
    await page.setViewportSize({ width: 320, height: 400 })
    await expect(page).toHaveURL(/#seller-details$/)
    await expect
      .poll(async () => (await selectedWithinStrip(page)).inside)
      .toBe(true)
    const narrowed = await measure()
    expect(narrowed.scrollY).toBe(
      Math.min(40, Math.max(0, narrowed.scrollHeight - narrowed.innerHeight)),
    )
    await page.setViewportSize({ width: 320, height: 720 })
    await expect(page).toHaveURL(/#seller-details$/)
    await expect(page.getByRole('tab').last()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect
      .poll(async () => {
        const r = await selectedWithinStrip(page)
        return `${r.inside} tab ${Math.round(r.tab.x)}..${Math.round(r.tab.x + r.tab.width)} strip ${Math.round(r.strip.x)}..${Math.round(r.strip.x + r.strip.width)}`
      })
      .toMatch(/^true /)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})
