import { test, expect } from '@playwright/test'
import { reviewFixture } from '../helpers/seller-review-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller review waits for client readiness before accepting confirmation', async ({
  page,
}) => {
  const { f } = await reviewFixture(page, true)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  let writes = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/seller/review'
    )
      writes++
  })
  try {
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.reload({ waitUntil: 'commit' })
    const confirmation = page.getByRole('checkbox', {
      name: d.reviewConfirm,
      exact: true,
    })
    const approve = page.getByRole('button', {
      name: d.reviewApprove,
      exact: true,
    })
    const decline = page.getByRole('button', {
      name: d.reviewDecline,
      exact: true,
    })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toBeDisabled({ timeout: 2000 })
    await expect(approve).toBeDisabled()
    await expect(decline).toBeDisabled()
    await expect
      .poll(() =>
        page
          .locator('.reception-photos img')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true)
    release()
    await expect(confirmation).toBeEnabled()
    await expect(confirmation).not.toBeChecked()
    await expect(decline).toBeEnabled()
    await expect(approve).toBeDisabled()
    await confirmation.check()
    await expect(confirmation).toBeChecked()
    await expect(approve).toBeEnabled()
    expect(writes).toBe(0)
  } finally {
    release()
    try {
      await page.unrouteAll({ behavior: 'wait' })
    } finally {
      await f.close()
    }
  }
})
