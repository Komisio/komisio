import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('notification policy and assistance quota persist and usage is visible', async ({
  page,
}) => {
  const email = `p2-settings-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const hydrationErrors: string[] = []
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /hydration|hydrated|didn.t match/i.test(message.text())
      )
        hydrationErrors.push(message.text())
    })
    await f.commit()
    await page.goto('/settings')
    await page
      .getByLabel(d.storePolicy.automaticSellerNotifications, { exact: true })
      .check()
    await page
      .getByLabel(d.storePolicy.assistanceMonthlyQuota, { exact: true })
      .fill('7')
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(
      page.getByLabel(d.storePolicy.assistanceMonthlyQuota, { exact: true }),
    ).toHaveValue('7')
    await page.reload()
    await expect(
      page.getByLabel(d.storePolicy.automaticSellerNotifications, {
        exact: true,
      }),
    ).toBeChecked()
    await expect(
      page.getByLabel(d.storePolicy.assistanceMonthlyQuota, { exact: true }),
    ).toHaveValue('7')
    const usage = page.getByRole('region', { name: d.usage.title, exact: true })
    await expect(usage).toBeVisible()
    await expect(
      usage.getByText(
        `${d.usage.features.reception_assistance}: 0 · ${d.usage.quota} 7`,
        { exact: true },
      ),
    ).toBeVisible()
    const policy = (
      await f.db.query(
        'select policy from store_policy_versions where tenant_id=$1 order by version desc limit 1',
        [f.tenant],
      )
    ).rows[0].policy
    expect(policy.automaticSellerNotifications).toBe(true)
    expect(policy.assistanceMonthlyQuota).toBe(7)
    expect(hydrationErrors).toEqual([])
  } finally {
    await f.close()
  }
})

test('manual lifecycle price form appends the reviewed price and reason', async ({
  page,
}) => {
  const email = `p2-price-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic price jacket')
    await f.commit()
    await page.goto('/intake/lifecycle')
    await expect(
      page.getByRole('button', {
        name: d.lifecycle.applyMarkdown.replace('{step}', '1'),
        exact: true,
      }),
    ).toBeVisible()
    await page.getByLabel(d.lifecycle.price, { exact: true }).fill('149.95')
    await page
      .getByLabel(d.lifecycle.priceReason, { exact: true })
      .fill('Synthetic reviewed price')
    await page
      .getByRole('button', { name: d.lifecycle.setPrice, exact: true })
      .click()
    await expect(page.getByText(/149.95 SEK/)).toBeVisible()
    await page.reload()
    await expect(page.getByText(/149.95 SEK/)).toBeVisible()
    const price = (
      await f.db.query(
        'select price_ore,reason from item_prices where tenant_id=$1 and item_id=$2 order by seq desc limit 1',
        [f.tenant, item],
      )
    ).rows[0]
    expect(Number(price.price_ore)).toBe(14995)
    expect(
      (
        await f.db.query(
          "select detail from item_events where tenant_id=$1 and item_id=$2 and kind='price_set' and (detail->>'priceOre')::bigint=14995",
          [f.tenant, item],
        )
      ).rows[0].detail.reason,
    ).toBe('Synthetic reviewed price')
  } finally {
    await f.close()
  }
})
