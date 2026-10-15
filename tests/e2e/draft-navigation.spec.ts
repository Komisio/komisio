import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('retired draft links redirect safely and bag inspection stays tenant-scoped', async ({
  page,
  browser,
}) => {
  const email = `draft-nav-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const own = await p2Fixture(email)
  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  })
  try {
    await own.commit()
    const otherPage = await otherContext.newPage()
    const otherEmail = `draft-other-${randomUUID()}@example.test`
    await register(otherPage, otherEmail, `K!${randomUUID()}`)
    const other = await p2Fixture(otherEmail)
    try {
      const item = await other.item('Synthetic private item')
      const { reception, bag } = (
        await other.db.query(
          'select i.origin_id reception, s.bag_id bag from items i join reception_sessions s on s.id=i.origin_id where i.tenant_id=$1 and i.id=$2',
          [other.tenant, item],
        )
      ).rows[0]
      await other.commit()
      await otherPage.goto(`/intake/bags/${bag}/inspect`)
      await expect(
        otherPage.getByText('Synthetic private item', { exact: true }),
      ).toBeVisible()
      await otherPage.goto(`/intake/bags?draft=${reception}`)
      await expect(otherPage).toHaveURL(/\/intake$/)
      for (const value of [reception, randomUUID(), 'invalid']) {
        await page.goto(`/intake/bags?draft=${value}`)
        await expect(page).toHaveURL(/\/intake$/)
        await expect(
          page.getByText('Synthetic private item', { exact: true }),
        ).toHaveCount(0)
      }
      await page.goto(`/intake/bags/${bag}/inspect`)
      await expect(
        page.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Synthetic private item', { exact: true }),
      ).toHaveCount(0)
    } finally {
      await other.close()
    }
  } finally {
    await otherContext.close()
    await own.close()
  }
})
