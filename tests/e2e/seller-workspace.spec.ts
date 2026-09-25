import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller workspace keeps scoped lists and accessible tab navigation together', async ({
  page,
}, testInfo) => {
  const email = `workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Seller workspace coat')
    const other = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Other synthetic seller',
        `other-${randomUUID()}@example.test`,
        '',
      ])
    ).rows[0].id
    await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      other,
      f.agreement,
      'Other proof',
    ])
    await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      other,
      'Other seller dropoff',
      f.agreement,
    ])
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}`)
    await expect(page.getByRole('tab')).toHaveCount(7)
    const overview = page.getByRole('tab', {
      name: d.sellerWorkspace.overview,
      exact: true,
    })
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('seller-overview.png'),
      fullPage: true,
    })
    await overview.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tabpanel')).toContainText(
      d.sellerWorkspace.dropoffs,
    )
    await expect(
      page.getByRole('tabpanel').locator('.seller-workspace-list li'),
    ).toHaveCount(1)
    await expect(page.getByRole('tabpanel')).not.toContainText(
      'Other seller dropoff',
    )
    await page
      .getByRole('tab', { name: d.sellerWorkspace.items, exact: true })
      .click()
    await expect(
      page
        .getByRole('tabpanel')
        .getByRole('link', { name: 'Seller workspace coat', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('tab', { name: d.sellerWorkspace.items, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.terms, exact: true })
      .click()
    await expect(page.getByRole('tabpanel')).toContainText(
      'Synthetic paper agreement',
    )
    await page.goBack()
    await expect(
      page.getByRole('tab', { name: d.sellerWorkspace.items, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      page
        .getByRole('tabpanel')
        .getByRole('link', { name: 'Seller workspace coat', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('seller-items-mobile.png'),
      fullPage: true,
    })
    await page.goto(`/intake/sellers/${other}#seller-items`)
    await expect(page.getByRole('tabpanel')).toContainText(
      d.sellerWorkspace.noItems,
    )
  } finally {
    await f.close()
  }
})
