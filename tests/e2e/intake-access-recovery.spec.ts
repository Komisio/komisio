import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const error of ['AUTH_REQUIRED', 'FORBIDDEN'])
  for (const uncertain of [false, true])
    test(`purchase ${error} ${uncertain ? 'server failure retains retry' : 'answered refusal offers reload'}`, async ({
      page,
    }) => {
      const email = `purchase-access-${randomUUID()}@example.test`
      await register(page, email, `K!${randomUUID()}`)
      const f = await p2Fixture(email)
      try {
        await f.commit()
        await page.goto('/intake/purchases')
        await page.locator('.purchase-create > summary').click()
        const price = page.locator('#purchase-price')
        const form = page.locator('form').filter({ has: price })
        await price.fill('45,25')
        await page
          .locator('#purchase-evidence')
          .fill('Synthetic access recovery')
        await form.locator('input[type=checkbox][required]').check()
        const requests: Record<string, unknown>[] = []
        await page.route('**/api/intake', async (route) => {
          const command = route.request().postDataJSON()
          if (command.action !== 'registerPurchase') return route.continue()
          requests.push(command)
          return route.fulfill({
            status: uncertain ? 500 : error === 'AUTH_REQUIRED' ? 401 : 403,
            json: { error },
          })
        })
        await form
          .getByRole('button', { name: d.purchases.register, exact: true })
          .click()
        await expect(form.getByRole('alert')).toHaveText(
          uncertain ? d.intake.failed : d.intake.denied,
        )
        await expect(price).toHaveValue('45,25')
        await expect(price).toBeDisabled()
        const retry = form.getByRole('button', {
          name: d.intake.retry,
          exact: true,
        })
        const reload = form.getByRole('link', {
          name: d.intake.reload,
          exact: true,
        })
        if (uncertain) {
          await expect(reload).toHaveCount(0)
          await expect(retry).toBeEnabled()
          await retry.click()
          await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
          expect(requests).toHaveLength(2)
          expect(requests[1]).toEqual(requests[0])
        } else {
          await expect(reload).toBeVisible()
          await expect(retry).toBeDisabled()
          expect(requests).toHaveLength(1)
        }
        expect(
          (
            await f.db.query(
              'select count(*)::int n from purchase_receipts where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
        ).toBe(0)
      } finally {
        await f.close()
      }
    })
