import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('starting a reception requires choosing among multiple sellers and keeps a single search match convenient', async ({
  page,
}) => {
  const email = `reception-choice-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const other = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Another synthetic seller',
        `other-${randomUUID()}@example.test`,
        '',
      ])
    ).rows[0].id
    await f.commit()
    await page.goto('/intake/reception')
    const seller = page.getByLabel(d.reception.seller, { exact: true })
    const start = page.getByRole('button', {
      name: d.reception.start,
      exact: true,
    })
    await expect(seller).toHaveValue('')
    await expect(start).toBeDisabled()
    await seller.selectOption(other)
    await expect(start).toBeEnabled()
    await start.click()
    await expect(page).toHaveURL(/\/intake\/reception\/[a-f0-9-]+$/)
    const session = new URL(page.url()).pathname.split('/').pop()
    expect(
      (
        await f.db.query(
          'select seller_id from reception_sessions where tenant_id=$1 and id=$2',
          [f.tenant, session],
        )
      ).rows[0].seller_id,
    ).toBe(other)
    await page.goto('/intake/reception?q=Synthetic%20P2%20seller')
    await expect(seller).toHaveValue(f.seller)
    await expect(start).toBeEnabled()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_sessions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
