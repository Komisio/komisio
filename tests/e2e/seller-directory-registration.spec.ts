import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('directory registration and duplicate selection stay in the seller workspace', async ({
  page,
}) => {
  const email = `seller-directory-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const existing = (
      await f.db.query('select email from sellers where id=$1', [f.seller])
    ).rows[0].email
    await f.commit()
    await page.goto('/intake/sellers')
    await page
      .getByRole('link', { name: d.sellersList.register, exact: true })
      .click()
    await expect(page).toHaveURL('/intake/sellers/new')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic directory seller')
    await page.getByLabel(d.intake.email, { exact: true }).fill(existing)
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    const duplicate = page
      .getByRole('alert')
      .getByRole('link', { name: 'Synthetic P2 seller', exact: true })
    await expect(duplicate).toHaveAttribute(
      'href',
      `/intake/sellers/${f.seller}`,
    )
    await duplicate.click()
    await expect(page).toHaveURL(`/intake/sellers/${f.seller}`)
    await page.goto('/intake/sellers/new')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic new directory seller')
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill(`new-${randomUUID()}@example.test`)
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/sellers\/[0-9a-f-]{36}$/)
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic new directory seller',
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
