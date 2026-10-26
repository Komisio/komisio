import { expect, type Locator } from '@playwright/test'

/** Detail destinations may also carry the list origin introduced by #650.
 * Navigation journeys assert that origin separately; business-flow tests still
 * assert the exact path, fragment and every other query parameter here. */
export async function expectDetailTarget(link: Locator, target: string) {
  await expect
    .poll(async () => {
      const href = await link.getAttribute('href')
      if (!href) return href
      const url = new URL(href, 'https://komisio.invalid')
      if (url.origin !== 'https://komisio.invalid') return url.href
      url.searchParams.delete('returnTo')
      return url.pathname + url.search + url.hash
    })
    .toBe(target)
}
