import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('quick intake focuses invalid fields without sending or discarding a partial item', async ({
  page,
}) => {
  const email = `quick-validation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    const submit = page.getByRole('button', {
      name: d.quickIntake.submit,
      exact: true,
    })
    let requests = 0
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/intake/quick') &&
        request.method() === 'POST'
      )
        requests++
    })
    await price.fill('150')
    await submit.click()
    await expect(description).toBeFocused()
    await expect(description).toBeInViewport()
    await expect(description).toHaveAttribute('aria-invalid', 'true')
    await expect(description).toHaveAccessibleDescription(
      d.quickIntake.descriptionRequired,
    )
    await expect(price).not.toHaveAttribute('aria-invalid', 'true')
    await expect(price).toHaveValue('150')
    await description.fill('Synthetic corrected lamp')
    for (const invalid of ['invalid', '0', '1000000']) {
      await price.fill(invalid)
      await submit.click()
      await expect(price).toBeFocused()
      await expect(price).toBeInViewport()
      await expect(price).toHaveAccessibleDescription(
        d.quickIntake.priceInvalid,
      )
      await expect(price).toHaveAttribute('aria-invalid', 'true')
      await expect(description).not.toHaveAttribute('aria-invalid', 'true')
      await expect(description).toHaveValue('Synthetic corrected lamp')
    }
    expect(requests).toBe(0)
    await price.fill('150,50')
    await price.press('Enter')
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done).toContainText('150,50')
    expect(requests).toBe(1)
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    await expect(description).not.toHaveAttribute('aria-invalid', 'true')
    await expect(price).not.toHaveAttribute('aria-invalid', 'true')
    await expect(
      page.locator('#quick-description-error, #quick-price-error'),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})
