import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('repeating an unchanged day close confirms each command while retaining the existing document', async ({
  page,
}) => {
  const email = `canonical-close-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic canonical close item')
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.goto('/intake/accounting')
    const date = page.locator('#close-date')
    const form = page.locator('form').filter({ has: date })
    await date.fill('2020-01-02')
    const results: { commandId: string; id: string; sent: string }[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'generateDayClose') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      results.push({ ...(await response.json()), sent: command.requestId })
      await route.fulfill({ response })
    })
    const save = form.getByRole('button', {
      name: d.accounting.generate,
      exact: true,
    })
    await save.click()
    await expect(form.getByRole('status')).toHaveText(d.accounting.generated)
    await expect(date).toBeEnabled()
    await save.click()
    await expect.poll(() => results.length).toBe(2)
    await expect(date).toBeEnabled()
    await expect(form.getByRole('alert')).toHaveCount(0)
    expect(results[0].commandId).toBe(results[0].sent)
    expect(results[1].commandId).toBe(results[1].sent)
    expect(results[0].commandId).not.toBe(results[1].commandId)
    expect(results[0].id).toBe(results[1].id)
    expect(results[1].id).not.toBe(results[1].commandId)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from day_closes where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
