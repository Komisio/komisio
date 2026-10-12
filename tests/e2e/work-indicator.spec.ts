import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('shared work indicator covers slow actions, errors, locales and reduced motion', async ({
  page,
}) => {
  const email = `work-indicator-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release = () => {}
  let requests = 0
  try {
    await f.commit()
    await page.route('**/api/agreements/assistance', async (route) => {
      requests++
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await route.fulfill({
        status: 403,
        json: { error: 'ASSISTANCE_DISABLED' },
      })
    })
    const indicator = page.getByTestId('work-indicator')
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const words = JSON.parse(
        await readFile(
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
      await page.goto('/intake/agreements#agreements-publish')
      await page.reload()
      await expect(indicator).toHaveCount(0)
      await page
        .getByRole('button', { name: words.agreements.ai.create, exact: true })
        .click()
      await expect(indicator).toHaveAccessibleName(words.working)
      await expect(indicator).toBeVisible()
      await expect(page.locator('.agreement-ai button')).toBeDisabled()
      await page.setViewportSize({ width: 320, height: 740 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(
        await indicator
          .locator('.work-spinner')
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe('none')
      if (locale === 'sv') {
        await page.screenshot({
          path: 'private/work-indicator-mobile.png',
          fullPage: true,
        })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.screenshot({
          path: 'private/work-indicator-desktop.png',
          fullPage: true,
        })
      }
      release()
      await expect(
        page.locator('.agreement-ai').getByRole('alert'),
      ).toContainText(words.agreements.ai.unavailable)
      await expect(indicator).toHaveCount(0)
      await expect(page.locator('.agreement-ai button')).toBeEnabled()
      await expect(page.locator('#agreement-body')).toHaveValue('Only a test')
    }
    expect(requests).toBe(8)
  } finally {
    release()
    await f.close()
  }
})

test('navigation work ends after rendering and a cancelled dirty-form link does not start work', async ({
  page,
}) => {
  const email = `work-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.route('**/intake/stock**', async (route) => {
      await gate
      await route.continue()
    })
    await page.goto('/intake/agreements#agreements-publish')
    const indicator = page.getByTestId('work-indicator')
    await page.locator('#agreement-body').fill('Unsaved synthetic terms')
    const dialogPromise = page.waitForEvent('dialog')
    const click = page.locator('.sidebar a[href="/intake/stock"]').click()
    const dialog = await dialogPromise
    await dialog.dismiss()
    await click
    await expect(page).toHaveURL(/agreements/)
    await expect(indicator).toHaveCount(0)
    await page.locator('#agreement-body').fill('Only a test')
    await page.locator('.sidebar a[href="/intake/stock"]').click()
    await expect(indicator).toBeVisible()
    release()
    await expect(page).toHaveURL('/intake/stock')
    await expect(page.locator('h1')).toHaveText(d.stock.title)
    await expect(indicator).toHaveCount(0)
    await page.unroute('**/intake/stock**')
    const filterGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/intake/stock?**', async (route) => {
      await filterGate
      await route.continue()
    })
    await page.locator('#stock-ownership').selectOption('store')
    await page.locator('.stock-ownership-filter').getByRole('button').click()
    await expect(indicator).toBeVisible()
    await expect(page.getByRole('tab').first()).toBeDisabled()
    release()
    await expect(page).toHaveURL(/ownership=store/)
    await expect(indicator).toHaveCount(0)
    await expect(page.getByRole('tab').first()).toBeEnabled()
  } finally {
    release()
    await f.close()
  }
})

test('leaving an active form releases its work indicator without retrying the request', async ({
  page,
}) => {
  const email = `work-unmount-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release = () => {}
  let calls = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.route('**/api/agreements/assistance', async (route) => {
      calls++
      await gate
      await route
        .fulfill({ status: 403, json: { error: 'ASSISTANCE_DISABLED' } })
        .catch(() => {})
    })
    await page.goto('/intake/agreements#agreements-publish')
    await page.locator('.agreement-ai button').click()
    await expect(page.getByTestId('work-indicator')).toBeVisible()
    const dialogPromise = page.waitForEvent('dialog')
    const navigate = page.locator('.sidebar a[href="/intake/sellers"]').click()
    await (await dialogPromise).accept()
    await navigate
    await expect(page).toHaveURL('/intake/sellers')
    await expect(page.locator('.seller-directory-search')).toBeVisible()
    await expect(page.getByTestId('work-indicator')).toHaveCount(0)
    release()
    expect(calls).toBe(1)
  } finally {
    release()
    await f.close()
  }
})
