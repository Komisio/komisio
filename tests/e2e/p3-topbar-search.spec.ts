import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The label search in the top bar opens a bag by its K-reference from any page.
test('the top bar search opens a bag by its label reference', async ({
  page,
}) => {
  const email = `p3-search-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Searchable jacket')
    await f.commit()
    const bag = (
      await f.db.query(
        'select id,reference from bag_receipts where tenant_id=$1 order by reference desc limit 1',
        [f.tenant],
      )
    ).rows[0] as { id: string; reference: number }
    await page.goto('/intake/economy')
    const search = page.getByRole('search', {
      name: d.openByReference.title,
      exact: true,
    })
    await search
      .getByLabel(d.openByReference.reference, { exact: true })
      .fill(`k-${bag.reference}`)
    await search
      .getByLabel(d.openByReference.reference, { exact: true })
      .press('Enter')
    await expect(page).toHaveURL(new RegExp(`/intake/bags/${bag.id}/inspect`))
    await page.goto('/intake/open?ref=K-999999')
    await expect(
      page.getByText(d.openByReference.notFound.replace('{ref}', 'K-999999'), {
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
