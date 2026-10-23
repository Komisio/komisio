import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const mode of ['bag', 'quick'] as const) {
  test(`${mode}: registered item returns to its intake, including direct access`, async ({
    page,
  }, info) => {
    const email = `intake-back-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const bag = randomUUID()
      if (mode === 'bag')
        await f.db.query("select receive_bag_with_agreement($1,$2,$3,'',$4)", [
          f.tenant,
          bag,
          f.seller,
          f.agreement,
        ])
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(
        mode === 'bag' ? `/intake/bags/${bag}/inspect` : '/intake/quick',
      )
      if (mode === 'quick')
        await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
      await page.locator('#quick-description').fill('Synthetic navigation item')
      await page.locator('#quick-price').fill('125')
      await page
        .getByRole('button', {
          name: mode === 'bag' ? d.bagIntake.save : d.quickIntake.submit,
          exact: true,
        })
        .click()
      await page
        .getByRole('link', { name: d.quickIntake.openItem, exact: true })
        .click()
      await expect(page).toHaveURL(/\/intake\/items\/[0-9a-f-]{36}/)
      const itemPath = new URL(page.url()).pathname
      const itemId = itemPath.split('/').at(-1)!
      const session = (
        await f.db.query(
          'select origin_id from items where tenant_id=$1 and id=$2',
          [f.tenant, itemId],
        )
      ).rows[0].origin_id
      const intake =
        mode === 'bag'
          ? `/intake/bags/${bag}/inspect`
          : `/intake/reception/${session}`
      const back = page.getByRole('link', {
        name: d.items.backToIntake,
        exact: true,
      })
      await expect(back).toBeVisible()
      await expect(
        page.getByRole('link', { name: d.items.backToList, exact: true }),
      ).toHaveCount(0)
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: info.outputPath('intake-back-mobile.png'),
        fullPage: true,
      })
      await back.click()
      await expect(page).toHaveURL(new RegExp(intake))
      if (mode === 'bag') {
        const listing = `${intake}?itemSort=title&itemDirection=desc&itemPage=1`
        await page.goto(listing)
        await page.locator('.inventory-open-item').click()
        await expect(page).toHaveURL(/\/intake\/items\/[0-9a-f-]{36}/)
        await page.reload()
        await expect(back).toHaveAttribute(
          'href',
          `${listing}#inventory-item-${itemId}`,
        )
        await back.click()
        await expect(page).toHaveURL(
          new URL(`${listing}#inventory-item-${itemId}`, page.url()).href,
        )
        await expect(page.locator('.inventory-row')).toBeInViewport()
        await expect(page.locator('#quick-description')).not.toBeFocused()
        await page.reload()
        // Reload must not re-arm an unrelated editor either. The explicit
        // return link's scroll position is checked above before reloading.
        await expect(page.locator('#quick-description')).not.toBeFocused()
        // The stepwise registration page for a bag item also returns to its bag.
        await page.goto(`/intake/reception/${session}`)
        await expect(back).toHaveAttribute('href', intake)
      }
      // Opening an accepted reception retains the source in a refreshable URL.
      await page.goto(`/intake/reception/${session}`)
      const open = page.getByRole('link', { name: d.items.open, exact: true })
      await expect(open).toHaveCount(2)
      expect(await open.nth(1).getAttribute('href')).toBe(
        await open.first().getAttribute('href'),
      )
      await open.first().click()
      await expect(page).toHaveURL(/\/intake\/items\/[0-9a-f-]{36}/)
      await expect(back).toHaveAttribute(
        'href',
        mode === 'bag' ? `${intake}#inventory-item-${itemId}` : intake,
      )
      // A directly opened item still offers its intake beside the inventory link.
      await page.goto(itemPath)
      await expect(back).toHaveAttribute('href', intake)
      await expect(
        page.getByRole('link', { name: d.items.backToList, exact: true }),
      ).toHaveAttribute('href', '/intake/items')
    } finally {
      await f.close()
    }
  })
}
