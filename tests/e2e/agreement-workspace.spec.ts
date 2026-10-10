import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff can record the displayed agreement while registering or editing a seller, with safe retry', async ({
  page,
}) => {
  const email = `agreement-workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const translation = randomUUID()
    await f.db.query(
      "select publish_agreement_translation($1,$2,$3,'TEST svenska','Synthetic Swedish terms','sv')",
      [f.tenant, translation, f.agreement],
    )
    await f.commit()
    await page.goto('/intake/sellers/new')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Registration TEST')
    await page.getByLabel(d.intake.phone, { exact: true }).fill('0712345678')
    await expect(
      page.getByLabel(d.agreements.workspace.approval),
    ).not.toBeChecked()
    await page
      .getByLabel(d.agreements.language, { exact: true })
      .selectOption(translation)
    await page.getByLabel(d.agreements.workspace.approval).check()
    await page
      .getByLabel(d.agreements.workspace.reference, { exact: true })
      .fill('Paper TEST 1')
    const requests: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'registerSeller') return route.continue()
      requests.push(command)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (requests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/sellers\/[a-f0-9-]+$/)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    const seller = new URL(page.url()).pathname.split('/').at(-1)!
    expect(
      (
        await f.db.query(
          'select agreement_id,reference,source,translation_id from seller_agreement_evidence where seller_id=$1',
          [seller],
        )
      ).rows,
    ).toEqual([
      {
        agreement_id: f.agreement,
        reference: 'Paper TEST 1',
        source: 'staff_recorded',
        translation_id: translation,
      },
    ])
    await page.goto(`/intake/sellers/${seller}#seller-terms`)
    await expect(page.getByText('Paper TEST 1', { exact: false })).toBeVisible()
    const next = randomUUID()
    await f.asActor(f.actor, () =>
      f.db.query(
        "select publish_seller_agreement($1,$2,$3,'New TEST terms','Fictional replacement','sv',false)",
        [f.tenant, next, f.agreement],
      ),
    )
    await page.goto(`/intake/sellers/${seller}#seller-details`)
    // A hash-only navigation keeps the mounted seller workspace; reload to
    // deliberately review the newly published terms before recording approval.
    await page.reload()
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await page.getByLabel(d.intake.name, { exact: true }).fill('Edited TEST')
    await page.getByLabel(d.agreements.workspace.approval).check()
    await page
      .getByLabel(d.agreements.workspace.reference, { exact: true })
      .fill('Paper TEST 2')
    await page
      .getByRole('button', { name: d.sellerDetails.save, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Edited TEST', exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select agreement_id from seller_agreement_evidence where seller_id=$1 order by recorded_at',
          [seller],
        )
      ).rows.map((r: { agreement_id: string }) => r.agreement_id),
    ).toEqual([f.agreement, next])
    await page.goto(`/intake/agreements?status=accepted#agreements-sellers`)
    await expect(page.locator('.agreement-acceptances tbody tr')).toHaveCount(1)
    await expect(page.locator('.agreement-acceptances')).toContainText(
      'Edited TEST',
    )
    await page
      .getByRole('combobox', {
        name: d.agreements.workspace.status,
        exact: true,
      })
      .selectOption('missing')
    await page
      .getByRole('button', { name: d.intake.searchButton, exact: true })
      .click()
    await expect(page.locator('.agreement-acceptances')).toContainText(
      'Synthetic P2 seller',
    )
    await expect(page.locator('.agreement-acceptances')).not.toContainText(
      'Edited TEST',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await page.screenshot({
      path: 'private/agreement-acceptances-mobile.png',
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: d.agreements.workspace.versions, exact: true })
      .click()
    await expect(page.locator('.agreement-history')).toContainText('Svenska')
    await expect(page.locator('.agreement-history')).toContainText('English')
    await expect(
      page
        .locator('.agreement-history tbody tr')
        .filter({ hasText: d.agreements.workspace.active }),
    ).toHaveCount(1)
    await page.screenshot({
      path: 'private/agreement-versions-mobile.png',
      fullPage: true,
    })
    const versionsTab = page.getByRole('tab', {
      name: d.agreements.workspace.versions,
      exact: true,
    })
    await versionsTab.focus()
    await versionsTab.press('ArrowRight')
    await expect(
      page.getByRole('tab', {
        name: d.agreements.workspace.sellers,
        exact: true,
      }),
    ).toBeFocused()
    await expect(
      page.getByRole('tab', {
        name: d.agreements.workspace.sellers,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('tab', { name: d.agreements.workspace.sellers, exact: true })
      .press('Home')
    await expect(versionsTab).toBeFocused()
    await expect(versionsTab).toHaveAttribute('aria-selected', 'true')
  } finally {
    await f.close()
  }
})

test('agreement acceptance register reaches sellers and versions beyond the first page', async ({
  page,
}) => {
  const email = `agreement-pages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let n = 0; n < 26; n++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        `Page seller ${String(n).padStart(2, '0')}`,
        '',
        `012${n}`,
      ])
    let base = f.agreement
    for (let n = 0; n < 20; n++) {
      const id = randomUUID()
      await f.db.query(
        "select publish_seller_agreement($1,$2,$3,$4,'Synthetic version','sv',false)",
        [f.tenant, id, base, `Page version ${n}`],
      )
      base = id
    }
    await f.commit()
    await page.goto('/intake/agreements#agreements-sellers')
    await expect(page.locator('.agreement-acceptances tbody tr')).toHaveCount(
      25,
    )
    await page
      .locator('.agreement-acceptances')
      .getByRole('link', { name: d.agreements.workspace.next, exact: true })
      .click()
    await expect(page.locator('.agreement-acceptances tbody tr')).toHaveCount(2)
    await page
      .getByRole('tab', { name: d.agreements.workspace.versions, exact: true })
      .click()
    await page
      .locator('.agreement-history')
      .getByRole('link', { name: d.agreements.workspace.next, exact: true })
      .click()
    await expect(page.locator('.agreement-history tbody tr')).toHaveCount(1)
    await page
      .locator('.agreement-history')
      .getByRole('link', { name: /Synthetic terms/ })
      .click()
    await page
      .getByRole('tab', { name: d.agreements.workspace.sellers, exact: true })
      .click()
    await page
      .getByRole('combobox', {
        name: d.agreements.workspace.status,
        exact: true,
      })
      .selectOption('accepted')
    await page
      .getByRole('button', { name: d.intake.searchButton, exact: true })
      .click()
    await expect(page.locator('.agreement-acceptances tbody tr')).toHaveCount(1)
    await expect(page.locator('.agreement-acceptances')).toContainText(
      'Synthetic P2 seller',
    )
  } finally {
    await f.close()
  }
})
