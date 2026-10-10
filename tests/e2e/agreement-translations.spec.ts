import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('one agreement offers multiple immutable languages and portal acceptance counts across them', async ({
  page,
}) => {
  const email = `agreement-translations-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = randomUUID()
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      seller,
      'Translation TEST seller',
      email,
      '',
    ])
    await f.commit()
    await page.goto('/intake/agreements')
    await page.getByText(d.agreements.translations.add, { exact: true }).click()
    const publisher = page.locator('.agreement-translations')
    await publisher
      .getByLabel(d.agreements.language, { exact: true })
      .selectOption('sv')
    await publisher
      .getByLabel(d.agreements.name, { exact: true })
      .fill('TEST svenska villkor')
    await publisher
      .getByLabel(d.agreements.body, { exact: true })
      .fill('Syntetisk svensk avtalstext för test.')
    await page
      .getByRole('tab', {
        name: d.agreements.workspace.sellers,
        exact: true,
      })
      .click()
    await page
      .getByRole('tab', { name: d.agreements.workspace.versions, exact: true })
      .click()
    await expect(
      publisher.getByLabel(d.agreements.body, { exact: true }),
    ).toHaveValue('Syntetisk svensk avtalstext för test.')
    await publisher
      .getByRole('button', {
        name: d.agreements.translations.publish,
        exact: true,
      })
      .click()
    await expect(publisher.getByRole('status')).toContainText(
      d.agreements.translations.published,
    )
    await expect(page.locator('.agreement-history tbody tr')).toHaveCount(1)
    await expect(page.locator('.agreement-history')).toContainText('Svenska')
    await expect(page.locator('.agreement-history')).toContainText('English')
    await page
      .locator('.agreement-reader')
      .getByRole('link', { name: 'Svenska', exact: true })
      .click()
    await expect(page.locator('.agreement-text')).toHaveText(
      'Syntetisk svensk avtalstext för test.',
    )
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.agreement-text')).toBeVisible()
    await expect(publisher).toBeHidden()
    await page.emulateMedia({ media: 'screen' })
    const translation = (
      await f.db.query(
        'select id from seller_agreement_translations where agreement_id=$1',
        [f.agreement],
      )
    ).rows[0].id
    await page.goto(`/seller/agreement?seller=${seller}`)
    await page
      .getByRole('navigation', { name: d.agreements.language })
      .getByRole('link', { name: 'Svenska', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'TEST svenska villkor', exact: true }),
    ).toBeVisible()
    await page.route(
      '**/api/seller/agreement',
      async (route) => {
        const command = route.request().postDataJSON()
        expect(command.translationId).toBe(translation)
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page
      .getByRole('button', { name: d.sellerAgreement.accept, exact: true })
      .click()
    await expect(page.locator('article').getByRole('alert')).toBeVisible()
    await page
      .getByRole('button', { name: d.sellerAgreement.accept, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(
      d.sellerAgreement.accepted,
    )
    await page
      .getByRole('navigation', { name: d.agreements.language })
      .getByRole('link', { name: 'English', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('Svenska')
    await expect(
      page.getByRole('button', { name: d.sellerAgreement.accept, exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select agreement_id,translation_id from seller_agreement_evidence where seller_id=$1',
          [seller],
        )
      ).rows,
    ).toEqual([{ agreement_id: f.agreement, translation_id: translation }])
    await page.goto(
      `/intake/agreements?q=Translation&status=accepted#agreements-sellers`,
    )
    await expect(page.locator('.agreement-acceptances tbody tr')).toHaveCount(1)
    await expect(page.locator('.agreement-acceptances tbody')).toContainText(
      'Svenska',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await expect(page.locator('.agreement-acceptances tbody')).toContainText(
      'Svenska',
    )
    await expect(page.locator('.agreement-acceptances tbody')).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('agreement-languages-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
