import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('continuous reception retains registration, personal agreement, approval and item drafts', async ({
  page,
  request,
}) => {
  const email = `quick-workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const translation = randomUUID()
    await f.db.query(
      "select publish_agreement_translation($1,$2,$3,'TEST svenska','Synthetic Swedish terms','sv')",
      [f.tenant, translation, f.agreement],
    )
    await f.commit()
    await page.goto('/intake/quick')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await page
      .getByRole('button', { name: d.quickIntake.newSeller, exact: true })
      .click()
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic quick seller')
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill(`quick-seller-${randomUUID()}@example.test`)
    await page
      .getByRole('button', { name: d.quickIntake.workspace.backToSearch })
      .click()
    await expect(
      page.getByLabel(d.quickIntake.searchSeller, { exact: true }),
    ).toBeFocused()
    await page
      .getByRole('button', { name: d.quickIntake.newSeller, exact: true })
      .click()
    await expect(page.getByLabel(d.intake.name, { exact: true })).toHaveValue(
      'Synthetic quick seller',
    )
    await expect(
      page.getByLabel(d.agreements.workspace.approval),
    ).not.toBeChecked()
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'registerSeller') return route.continue()
      commands.push(command)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (commands.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: d.quickIntake.workspace.backToSearch,
        exact: true,
      }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(
      page.getByText(d.quickIntake.workspace.sellerSaved),
    ).toBeVisible()
    await expect(page).toHaveURL('/intake/quick')
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    const seller = String(commands[0].requestId)
    const agreementPath = `/api/sellers/${seller}/agreement?tenant=${f.tenant}`
    const snapshot = await page.request.get(agreementPath)
    expect(snapshot.headers()['cache-control']).toBe('private, no-store')
    expect((await snapshot.json()).accepted).toBe(false)
    expect((await request.get(agreementPath)).status()).toBe(401)
    expect(
      (
        await page.request.get(agreementPath.replace(f.tenant, randomUUID()))
      ).status(),
    ).toBe(409)
    expect(
      (
        await page.request.get(agreementPath.replace(seller, randomUUID()))
      ).status(),
    ).toBe(404)
    const pdf = page.getByRole('link', {
      name: d.agreements.pdf.view,
      exact: true,
    })
    await expect(pdf).toHaveAttribute('href', new RegExp(`seller=${seller}`))
    await page
      .getByLabel(d.agreements.language, { exact: true })
      .selectOption(translation)
    const download = page.waitForEvent('download')
    await pdf.click()
    expect((await download).suggestedFilename()).toBe('agreement-v1-sv.pdf')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_evidence where seller_id=$1',
          [seller],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.getByLabel(d.agreements.workspace.approval).check()
    await page
      .getByLabel(d.agreements.workspace.reference, { exact: true })
      .fill('Synthetic signed paper')
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic continuous coat')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('180')
    await page.locator('#quick-agreement summary').click()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toBeVisible()
    await page.locator('#quick-agreement summary').click()
    await expect(
      page.getByLabel(d.agreements.workspace.reference, { exact: true }),
    ).toHaveValue('Synthetic signed paper')
    await page
      .getByRole('button', { name: d.agreements.record, exact: true })
      .click()
    await expect(
      page
        .locator('#quick-agreement summary')
        .getByText(d.quickIntake.workspace.agreementAccepted, { exact: true }),
    ).toBeVisible()
    await expect(page.locator('#quick-agreement summary')).toBeFocused()
    await expect(page.locator('#quick-agreement')).not.toHaveAttribute(
      'open',
      '',
    )
    expect(
      (
        await f.db.query(
          'select agreement_id, reference, translation_id from seller_agreement_evidence where seller_id=$1',
          [seller],
        )
      ).rows,
    ).toEqual([
      {
        agreement_id: f.agreement,
        reference: 'Synthetic signed paper',
        translation_id: translation,
      },
    ])
    await page.locator('#quick-agreement summary').press('Enter')
    await expect(pdf).toHaveAttribute('href', new RegExp(`text=${translation}`))
    await page.locator('#quick-agreement summary').press('Enter')
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `private/quick-continuous-${width}.png`,
        fullPage: true,
      })
    }
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toHaveValue('Synthetic continuous coat')
    await expect(
      page.getByLabel(d.quickIntake.price, { exact: true }),
    ).toHaveValue('180')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query('select seller_id from items where tenant_id=$1', [
          f.tenant,
        ])
      ).rows,
    ).toEqual([{ seller_id: seller }])
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.quick-seller-context')).toContainText(
      'Synthetic quick seller',
    )
  } finally {
    await f.close()
  }
})

test('changed agreement is reloaded inside reception without losing the item', async ({
  page,
}) => {
  const email = `quick-current-agreement-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify({ agreementRequiredFor: ['acceptance'] }),
      ],
    )
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(page.locator('#quick-agreement summary')).toContainText(
      d.quickIntake.workspace.agreementAccepted,
    )
    await page.locator('#quick-agreement summary').click()
    await expect(
      page.getByText(d.agreements.workspace.approved, { exact: true }),
    ).toBeVisible()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic retained coat')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('190')
    const nextAgreement = randomUUID()
    await f.asActor(f.actor, () =>
      f.db.query(
        "select publish_seller_agreement($1,$2,$3,'Synthetic changed terms','New fictional terms','sv',true)",
        [f.tenant, nextAgreement, f.agreement],
      ),
    )
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await page
      .getByRole('button', { name: d.quickIntake.recordAgreement, exact: true })
      .click()
    await expect(page.locator('#quick-agreement')).toHaveAttribute('open', '')
    const agreementPdf = page.getByRole('link', {
      name: d.agreements.pdf.view,
      exact: true,
    })
    await expect(agreementPdf).toHaveAttribute(
      'href',
      new RegExp(`version=${nextAgreement}`),
    )
    await expect(
      page.getByLabel(d.agreements.workspace.approval),
    ).not.toBeChecked()
    await page.getByLabel(d.agreements.workspace.approval).check()
    await page
      .getByLabel(d.agreements.workspace.reference, { exact: true })
      .fill('Synthetic current evidence')
    const latest = randomUUID()
    await f.asActor(f.actor, () =>
      f.db.query(
        "select publish_seller_agreement($1,$2,$3,'Synthetic latest terms','Latest fictional terms','sv',true)",
        [f.tenant, latest, nextAgreement],
      ),
    )
    await page
      .getByRole('button', { name: d.agreements.record, exact: true })
      .click()
    await expect(
      page.getByText(d.intake.agreementChanged, { exact: true }),
    ).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', {
        name: d.quickIntake.workspace.refreshAgreement,
        exact: true,
      })
      .click()
    await expect(agreementPdf).toHaveAttribute(
      'href',
      new RegExp(`version=${latest}`),
    )
    await expect(
      page.getByLabel(d.agreements.workspace.approval),
    ).not.toBeChecked()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toHaveValue('Synthetic retained coat')
    await expect(
      page.getByLabel(d.quickIntake.price, { exact: true }),
    ).toHaveValue('190')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_evidence where seller_id=$1',
          [f.seller],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
