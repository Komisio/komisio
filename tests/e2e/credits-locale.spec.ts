import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('Danish credits use Danish number formatting without purchasing', async ({
  page,
}) => {
  const email = `credits-locale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'dk', url: 'http://127.0.0.1:3000' },
      ])
    await page.goto('/settings?tab=credits')
    await expect(page.getByText(/cirka 4\.000 modtagne varer/)).toBeVisible()
  } finally {
    await f.close()
  }
})
