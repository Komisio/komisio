import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('AI HTTP fixture replaces agreement text directly and retries without duplicate generation', async ({
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
    await page.getByRole('tab').last().click()
    await page.locator('#agreement-language').selectOption('no')
    await page.locator('#agreement-title').fill('My agreement')
    await page
      .locator('#agreement-body')
      .fill('Keep this until generation succeeds')
    const generationRequests: Record<string, unknown>[] = []
    const decisionRequests: Record<string, unknown>[] = []
    await page.route('**/api/agreements/assistance', async (route) => {
      generationRequests.push(route.request().postDataJSON())
      const response = await route.fetch()
      await expect(page.getByTestId('work-indicator')).toBeVisible()
      expect(response.status(), await response.text()).toBe(200)
      if (generationRequests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page.route('**/api/operations', async (route) => {
      decisionRequests.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect((await response.json()).outcome).toBe('executed')
      if (decisionRequests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    const generate = page.locator('.agreement-ai button')
    await generate.click()
    await expect(
      page.locator('.agreement-ai').getByRole('alert'),
    ).toContainText(d.agreements.ai.pending)
    await expect(page.locator('#agreement-body')).toHaveValue(
      'Keep this until generation succeeds',
    )
    await generate.click()
    await expect(
      page.locator('.agreement-ai').getByRole('alert'),
    ).toContainText(d.agreements.ai.retryUse)
    await expect(page.locator('#agreement-body')).toHaveValue(
      'Keep this until generation succeeds',
    )
    await generate.click()
    await expect(page.locator('#agreement-body')).toHaveValue(/HTTP FIXTURE/)
    await expect(page.getByTestId('work-indicator')).toHaveCount(0)
    await expect(page.locator('#agreement-title')).toHaveValue('My agreement')
    await expect(page.locator('#agreement-language')).toHaveValue('no')
    expect(generationRequests).toHaveLength(2)
    expect(generationRequests[1]).toEqual(generationRequests[0])
    expect(decisionRequests).toHaveLength(2)
    expect(decisionRequests[1]).toEqual(decisionRequests[0])
    await expect(page.locator('.agreement-ai-preview')).toHaveCount(0)
    await expect(
      page.getByText('Fyll inn butikknavn.', { exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from agreement_ai_attempts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    // Successful generation is an unsaved edit, never an implicit publication.
    let warned = false
    page.once('dialog', async (dialog) => {
      warned = true
      await dialog.accept()
    })
    await page.reload()
    expect(warned).toBe(true)
    await expect(page.locator('#agreement-body')).toHaveValue('Only a test')
    await page.locator('#agreement-language').selectOption('no')
    await page.locator('#agreement-title').fill('')
    // A fresh generation respects the existing 20-second tenant rate limit.
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              "select not exists(select 1 from agreement_ai_attempts where tenant_id=$1 and created_at>clock_timestamp()-interval '20 seconds') ready",
              [f.tenant],
            )
          ).rows[0].ready,
        { timeout: 25000, intervals: [1000] },
      )
      .toBe(true)
    await generate.click()
    await expect(page.locator('#agreement-body')).toHaveValue(/HTTP FIXTURE/)
    await expect(page.locator('#agreement-title')).toHaveValue(
      'Syntetisk avtale',
    )
    expect(generationRequests[2].requestId).not.toBe(
      generationRequests[0].requestId,
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from agreement_ai_attempts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
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
