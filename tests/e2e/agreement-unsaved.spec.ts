import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelLeave(page: Page) {
  const prompt = page.waitForEvent('dialog')
  const click = page.locator('.sidebar a[href="/intake/sellers"]').click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

test('agreement draft survives folding, history and cancelled departure; restored text clears warning', async ({
  page,
}) => {
  const email = `agreement-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/agreements')
    const publisher = page.getByTestId('agreement-publisher')
    await publisher.locator('summary').click()
    const body = page.locator('#agreement-body')
    const original = await body.inputValue()
    await body.fill('Synthetic unpublished agreement draft')
    await publisher.locator('summary').click()
    await page.locator('.agreement-history summary').click()
    await page.locator('.agreement-history a').first().click()
    await expect(page).toHaveURL(/agreements\?version=/)
    await publisher.locator('summary').click()
    await expect(body).toHaveValue('Synthetic unpublished agreement draft')
    await cancelLeave(page)
    const prompt = page.waitForEvent('dialog')
    await page.evaluate(() => setTimeout(() => location.reload(), 0))
    const dialog = await prompt
    expect(dialog.type()).toBe('beforeunload')
    await dialog.dismiss()
    await expect(body).toHaveValue('Synthetic unpublished agreement draft')
    await body.fill(original)
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await page.locator('.sidebar a[href="/intake/sellers"]').click()
    await expect(page).toHaveURL('/intake/sellers')
    expect(unexpected).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('uncertain publication retains warning and retry identity; next version gets a fresh draft baseline', async ({
  page,
}) => {
  const email = `agreement-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/agreements')
    await page.getByTestId('agreement-publisher').locator('summary').click()
    await page.locator('#agreement-body').fill('Synthetic confirmed agreement')
    const requests: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action !== 'publishAgreement') return route.continue()
      requests.push(payload)
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (requests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.agreements.publish, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await cancelLeave(page)
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.agreements.published)
    await expect(page.locator('.agreement-text')).toHaveText(
      'Synthetic confirmed agreement',
    )
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    await page
      .getByRole('button', { name: d.agreements.nextVersion, exact: true })
      .click()
    const body = page.locator('#agreement-body')
    await expect(body).toHaveValue('Synthetic confirmed agreement')
    await body.fill('Synthetic next draft')
    await cancelLeave(page)
    await body.fill('Synthetic confirmed agreement')
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await page.locator('.sidebar a[href="/intake/sellers"]').click()
    await expect(page).toHaveURL('/intake/sellers')
    expect(unexpected).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await f.close()
  }
})

test('agreement requirement reflects the store policy even when the agreement flag is optional', async ({
  page,
}) => {
  const email = `agreement-policy-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify({ agreementRequiredFor: ['bag_receipt'] }),
      ],
    )
    await f.commit()
    await page.goto('/intake/agreements')
    await expect(
      page.getByText(d.agreements.required, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.agreements.optional, { exact: true }),
    ).not.toBeVisible()
  } finally {
    await f.close()
  }
})
