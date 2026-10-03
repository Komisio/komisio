import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function fixture(page: Page) {
  const email = `observation-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const session = randomUUID()
  await f.db.query('select create_reception_session($1,$2,$3)', [
    f.tenant,
    session,
    f.seller,
  ])
  await f.commit()
  await page.goto(`/intake/reception/${session}`)
  const description = page.locator('#garment-description')
  const form = page.locator('form').filter({ has: description })
  return { f, session, description, form }
}
async function fill(page: Page) {
  await page.locator('#garment-description').fill('Synthetic oak table')
  await page.locator('#garment-price').fill('250')
  await page.locator('#garment-reference').fill('Synthetic staff appraisal')
  await page
    .locator('#garment-rationale')
    .fill('Synthetic condition and current price')
}

test('reception observation drafts survive cancelled departure and folds; confirmed saving establishes a baseline', async ({
  page,
}) => {
  const { f, session, description, form } = await fixture(page)
  try {
    await fill(page)
    const summary = page
      .locator('.reception-step')
      .first()
      .locator(':scope > summary')
    await summary.click()
    await summary.click()
    await expect(description).toHaveValue('Synthetic oak table')
    const back = page.getByRole('link', { name: d.reception.back, exact: true })
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await back.click()
    await expect(page).toHaveURL(`/intake/reception/${session}`)
    await expect.poll(() => warnings).toBe(1)
    await expect(description).toHaveValue('Synthetic oak table')
    await form
      .getByRole('button', { name: d.reception.saveSources, exact: true })
      .click()
    await expect(page.locator('.reception-step').nth(1)).toHaveAttribute(
      'open',
      '',
    )
    // Reopen the first step if the confirmed server state folded it.
    if (!(await description.isVisible())) await summary.click()
    await expect(description).toHaveValue('Synthetic oak table')
    await description.fill('Later draft')
    await back.click()
    expect(warnings).toBe(2)
    await description.fill('Synthetic oak table')
    await back.click()
    await expect(page).toHaveURL('/intake/reception')
    expect(warnings).toBe(2)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_source_revisions where session_id=$1',
          [session],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

for (const failure of ['lost', 'wrong-id'])
  test(`an observation ${failure} reply retains the exact save and protects departure`, async ({
    page,
  }) => {
    const { f, session, description, form } = await fixture(page)
    try {
      await fill(page)
      const commands: unknown[] = []
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command.action !== 'saveReceptionSources') return route.continue()
        commands.push(command)
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (commands.length === 1) {
          if (failure === 'lost') return route.abort('failed')
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, id: randomUUID() }),
          })
        }
        return route.fulfill({ response })
      })
      await form
        .getByRole('button', { name: d.reception.saveSources, exact: true })
        .click()
      await expect(form.getByRole('alert')).toHaveText(d.reception.retry)
      await expect(description).toBeDisabled()
      let warnings = 0
      page.on('dialog', async (dialog) => {
        warnings++
        await dialog.dismiss()
      })
      await page
        .getByRole('link', { name: d.reception.back, exact: true })
        .click()
      await expect(page).toHaveURL(`/intake/reception/${session}`)
      await expect.poll(() => warnings).toBe(1)
      await form
        .getByRole('button', { name: d.reception.retryButton, exact: true })
        .click()
      await expect(page.locator('.reception-step').nth(1)).toHaveAttribute(
        'open',
        '',
      )
      expect(commands).toHaveLength(2)
      expect(commands[1]).toEqual(commands[0])
      expect(
        (
          await f.db.query(
            'select count(*)::int n from reception_source_revisions where session_id=$1',
            [session],
          )
        ).rows[0].n,
      ).toBe(1)
      await page
        .getByRole('link', { name: d.reception.back, exact: true })
        .click()
      await expect(page).toHaveURL('/intake/reception')
      await expect.poll(() => warnings).toBe(1)
    } finally {
      await f.close()
    }
  })
