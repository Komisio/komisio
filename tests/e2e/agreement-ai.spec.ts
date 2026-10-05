import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('AI HTTP fixture creates, restores and applies an agreement without publishing', async ({
  page,
}) => {
  test.skip(
    process.env.KOMISIO_TEST_AI_HTTP_FIXTURE !== 'enabled',
    'Dedicated local provider fixture only',
  )
  const email = `agreement-ai-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')||'{\"assistanceEnabled\":true}')",
      [f.tenant, randomUUID()],
    )
    await f.commit()
    await page.goto('/intake/agreements')
    await page.getByTestId('agreement-publisher').locator('summary').click()
    await page.locator('#agreement-language').selectOption('no')
    const generated = page.waitForResponse((r) =>
      r.url().endsWith('/api/agreements/assistance'),
    )
    await page
      .getByRole('button', { name: d.agreements.ai.create, exact: true })
      .click()
    const response = await generated
    expect(response.status(), await response.text()).toBe(200)
    const result = await response.json()
    await expect(page.locator('.agreement-ai-preview')).toContainText(
      'Syntetisk avtale',
    )
    await expect(page.locator('#agreement-body')).toHaveValue('Only a test')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    const repeated = await page.request.post('/api/agreements/assistance', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: response.request().postDataJSON(),
    })
    expect(await repeated.json()).toEqual(result)
    await page.reload()
    await expect(page.locator('.agreement-ai-preview')).toContainText(
      'Syntetisk avtale',
    )
    await expect(
      page.getByRole('button', { name: d.agreements.ai.use, exact: true }),
    ).toBeDisabled()
    await page.getByLabel(d.agreements.ai.replace, { exact: true }).check()
    const applied = page.waitForResponse((r) =>
      r.url().endsWith('/api/operations'),
    )
    await page
      .getByRole('button', { name: d.agreements.ai.use, exact: true })
      .click()
    expect((await (await applied).json()).outcome).toBe('executed')
    await expect(page.locator('#agreement-title')).toHaveValue(
      'Syntetisk avtale',
    )
    await expect(page.locator('#agreement-language')).toHaveValue('no')
    await expect(page.locator('#agreement-body')).toHaveValue(/HTTP FIXTURE/)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from agreement_ai_attempts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page
      .getByRole('button', { name: d.agreements.publish, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.agreements.published)
    await expect(page.locator('.agreement-reader')).toContainText(
      'HTTP FIXTURE',
    )
  } finally {
    await f.close()
  }
})
