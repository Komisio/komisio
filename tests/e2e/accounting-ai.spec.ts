import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Only the provider response is synthetic. Reservation, staging, approval and
// publication use the real local engine and session-bound HTTP commands.
test('AI account proposals preserve edits, recover lost responses and require explicit saving', async ({
  page,
}) => {
  const email = `accounting-ai-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const output = {
    rows: [
      {
        key: 'grossOre',
        account: '1930',
        side: 'debit',
        reason: 'Synthetic clearing candidate',
      },
      {
        key: 'sellerCreditOre',
        account: '2890',
        side: 'credit',
        reason: 'Synthetic liability candidate',
      },
    ],
    warnings: ['Review settlement account and return postings.'],
  }
  try {
    await f.commit()
    const requests: Record<string, unknown>[] = []
    const decisions: Record<string, unknown>[] = []
    await page.route('**/api/accounting/assistance', async (route) => {
      const command = route.request().postDataJSON()
      requests.push(command)
      let result:
        { reserved: boolean; status: string; output: unknown } | undefined
      await f.asActor(f.actor, async () => {
        result = (
          await f.db.query(
            "select begin_accounting_assistance($1,$2,$3,$4,'fixture') result",
            [
              command.tenantId,
              command.requestId,
              command.baseId,
              command.language,
            ],
          )
        ).rows[0].result
        if (result!.reserved)
          await f.db.query(
            'select complete_accounting_assistance($1,$2,$3,100,50)',
            [command.tenantId, command.requestId, output],
          )
      })
      await expect(page.getByTestId('work-indicator')).toBeVisible()
      if (requests.length === 1) return route.abort('failed')
      await route.fulfill({
        json: { id: command.requestId, status: 'ready', output },
      })
    })
    await page.route('**/api/operations', async (route) => {
      decisions.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect((await response.json()).outcome).toBe('executed')
      if (decisions.length === 1) return route.abort('failed')
      await route.fulfill({ response })
    })
    await page.goto('/intake/accounting?view=accounts')
    const map = page.locator('#account-map')
    const gross = map.locator('input[name="account:grossOre"]')
    const seller = map.locator('input[name="account:sellerCreditOre"]')
    const command = {
      tenantId: f.tenant,
      requestId: randomUUID(),
      baseId: null,
      language: 'sv',
    }
    expect(
      (
        await page.request.post('/api/accounting/assistance', {
          data: command,
          headers: { origin: 'https://foreign.example' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await page.request.post('/api/accounting/assistance', {
          data: { ...command, tenantId: randomUUID() },
          headers: { origin: 'http://127.0.0.1:3000' },
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await page.request.post('/api/accounting/assistance', {
          data: { ...command, model: 'untrusted' },
          headers: { origin: 'http://127.0.0.1:3000' },
        })
      ).status(),
    ).toBe(400)
    await gross.fill('1940')
    await map.locator('select[name="side:grossOre"]').selectOption('credit')
    const button = page.locator('.accounting-ai button')
    await expect(button).toHaveText(d.accounting.ai.create)
    await button.click()
    await expect(page.locator('.accounting-ai [role="alert"]')).toHaveText(
      d.accounting.ai.pending,
    )
    await expect(seller).toHaveValue('')
    // A reload restores the durable attempt without invoking the provider again.
    page.once('dialog', (dialog) => dialog.accept())
    await page.reload()
    await expect(button).toHaveText(d.accounting.ai.check)
    await gross.fill('1940')
    await map.locator('select[name="side:grossOre"]').selectOption('credit')
    await button.click()
    await expect(page.locator('.accounting-ai [role="alert"]')).toHaveText(
      d.accounting.ai.retryUse,
    )
    await button.click()
    await expect(seller).toHaveValue('2890')
    await expect(gross).toHaveValue('1940')
    await expect(map.locator('select[name="side:grossOre"]')).toHaveValue(
      'credit',
    )
    await expect(page.getByTestId('work-indicator')).toHaveCount(0)
    await expect(map.locator('.accounting-ai-review')).toContainText(
      d.accounting.ai.review,
    )
    expect(requests).toHaveLength(1)
    expect(decisions).toHaveLength(2)
    expect(decisions[1]).toEqual(decisions[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_ai_attempts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_maps where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await map.locator('.accounting-ai-reason summary').click()
    await expect(
      map.getByText('Synthetic liability candidate', { exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({
      path: 'private/accounting-ai-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 800 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
    await page.screenshot({
      path: 'private/accounting-ai-mobile.png',
      fullPage: true,
    })
    await seller.fill('2899')
    await expect(map.locator('.accounting-ai-reason')).toHaveCount(0)
    await map
      .getByRole('button', { name: d.accounting.publishMap, exact: true })
      .click()
    await expect(map).toContainText(`${d.accounting.mapVersion} 1`)
    expect(
      (
        await f.db.query('select map from accounting_maps where tenant_id=$1', [
          f.tenant,
        ])
      ).rows[0].map,
    ).toEqual({
      grossOre: { account: '1940', side: 'credit' },
      sellerCreditOre: { account: '2899', side: 'credit' },
    })
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_exports where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
