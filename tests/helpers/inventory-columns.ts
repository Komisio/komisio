import type { Page } from '@playwright/test'

export async function showInventoryColumns(page: Page) {
  const picker = page.locator('.inventory-column-picker')
  await picker.locator('summary').click()
  for (const checkbox of await picker.getByRole('checkbox').all())
    await checkbox.check()
  await picker.locator('summary').click()
}
