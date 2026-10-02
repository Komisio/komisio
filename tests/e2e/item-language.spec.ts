import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }
import no from '../../messages/no.json' with { type: 'json' }

test('store item language persists independently of UI locale and saved descriptions', async ({
  page,
}, testInfo) => {
  const email = `item-language-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic original description')
    await f.commit()
    await page.goto('/settings')
    const language = page.getByLabel(sv.storePolicy.itemLanguage, {
      exact: true,
    })
    await expect(language).toHaveValue('sv')
    await language.selectOption('no')
    await page.getByLabel(sv.storePolicy.confirm, { exact: true }).check()
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishStorePolicy',
    )
    await page
      .getByRole('button', { name: sv.storePolicy.publish, exact: true })
      .click()
    expect((await saved).status()).toBe(200)
    await page.reload()
    await expect(language).toHaveValue('no')
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'no', url: 'http://127.0.0.1:3000' },
      ])
    await page.reload()
    await expect(
      page.getByLabel(no.storePolicy.itemLanguage, { exact: true }),
    ).toHaveValue('no')
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByLabel(no.storePolicy.itemLanguage, { exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath('item-language-mobile.png'),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])
    await page.reload()
    await expect(language).toHaveValue('no')
    await page.goto(`/intake/items/${item}`)
    await expect(
      page.getByText('Synthetic original description', { exact: true }).first(),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
