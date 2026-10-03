import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('draft links cannot resolve a draft from a different store', async ({
  page,
  browser,
}) => {
  const email = `draft-nav-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const own = await p2Fixture(email)
  const otherContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3000',
  })
  try {
    await own.commit()
    const otherPage = await otherContext.newPage()
    const otherEmail = `draft-other-${randomUUID()}@example.test`
    await register(otherPage, otherEmail, `K!${randomUUID()}`)
    const other = await p2Fixture(otherEmail)
    try {
      const item = await other.item('Synthetic private draft')
      const draft = (
        await other.db.query(
          'select origin_id from items where tenant_id=$1 and id=$2',
          [other.tenant, item],
        )
      ).rows[0].origin_id
      await other.commit()
      await otherPage.goto(`/intake/bags?draft=${draft}`)
      await expect(otherPage).toHaveURL(
        new RegExp(`/inspect\\?draft=${draft}$`),
      )
      for (const value of [draft, randomUUID(), 'invalid']) {
        await page.goto(`/intake/bags?draft=${value}`)
        await expect(
          page.getByRole('heading', { name: d.notFound, exact: true }),
        ).toBeVisible()
        await expect(
          page.getByText('Synthetic private draft', { exact: true }),
        ).toHaveCount(0)
      }
    } finally {
      await other.close()
    }
  } finally {
    await otherContext.close()
    await own.close()
  }
})
