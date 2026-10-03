import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const damage of [
  'missing-ok',
  'wrong-id',
  'missing-command',
  'wrong-command',
  'uncommitted-wrong-command',
])
  test(`purchase confirmation rejects ${damage} and retries the exact operation`, async ({
    page,
  }) => {
    const email = `purchase-confirmation-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.goto('/intake/purchases')
      await page.locator('.purchase-create > summary').click()
      const price = page.locator('#purchase-price')
      const form = page.locator('form').filter({ has: price })
      await price.fill('145,25')
      await page
        .locator('#purchase-evidence')
        .fill('Synthetic confirmation evidence')
      await form.locator('input[type=checkbox][required]').check()
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command.action !== 'registerPurchase') return route.continue()
        requests.push(command)
        if (requests.length === 1 && damage === 'uncommitted-wrong-command')
          return route.fulfill({
            status: 200,
            json: { ok: true, id: command.requestId, commandId: randomUUID() },
          })
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (requests.length !== 1) return route.fulfill({ response })
        const body = await response.json()
        if (damage === 'missing-ok') delete body.ok
        if (damage === 'wrong-id') body.id = randomUUID()
        if (damage === 'missing-command') delete body.commandId
        if (damage === 'wrong-command') body.commandId = randomUUID()
        await route.fulfill({ status: 200, json: body })
      })
      await form
        .getByRole('button', { name: d.purchases.register, exact: true })
        .click()
      await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
      await expect(form.getByRole('status')).toHaveCount(0)
      await expect(price).toHaveValue('145,25')
      await expect(price).toBeDisabled()
      expect(
        (
          await f.db.query(
            'select count(*)::int n from purchase_receipts where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(damage === 'uncommitted-wrong-command' ? 0 : 1)
      await form
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect(form.getByRole('status')).toHaveText(d.purchases.registered)
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      const receipts = (
        await f.db.query(
          'select id,purchase_price_ore::text from purchase_receipts where tenant_id=$1',
          [f.tenant],
        )
      ).rows
      expect(receipts).toEqual([
        { id: requests[0].requestId, purchase_price_ore: '14525' },
      ])
    } finally {
      await f.close()
    }
  })
