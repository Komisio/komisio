import type { Page } from '@playwright/test'

/** Reveal the settings exercised by existing accounting workflow tests. */
export async function openAccountingSettings(page: Page) {
  for (const selector of [
    '.accounting-provider-disclosure',
    '.accounting-map-disclosure',
    '.fortnox-guide',
  ]) {
    const disclosure = page.locator(selector)
    if (
      (await disclosure.count()) &&
      (await disclosure.getAttribute('open')) === null
    )
      await disclosure.locator(':scope > summary').click()
  }
}
