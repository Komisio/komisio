import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner deletes an unused agreement and cannot delete a linked one', async ({
  page,
}) => {
  const email = `agreement-delete-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const unused = randomUUID()
  try {
    await f.db.query(
      "select publish_seller_agreement($1,$2,$3,'Unused TEST','Fictional unused agreement','sv',false)",
      [f.tenant, unused, f.agreement],
    )
    await f.commit()
    await page.goto('/intake/agreements')
    const linked = page.getByRole('row').filter({ hasText: 'Synthetic terms' })
    const fresh = page.getByRole('row').filter({ hasText: 'Unused TEST' })
    await expect(linked).toContainText(d.agreements.workspace.deletion.linked)
    await expect(
      linked.getByRole('button', {
        name: d.agreements.workspace.deletion.remove,
      }),
    ).toHaveCount(0)
    const name = `Version 2 · Unused TEST`
    await fresh
      .getByRole('button', {
        name: `${d.agreements.workspace.deletion.remove}: ${name}`,
        exact: true,
      })
      .click()
    await expect(
      fresh.getByText(
        d.agreements.workspace.deletion.confirm.replace('{name}', name),
        { exact: true },
      ),
    ).toBeVisible()
    await fresh
      .getByRole('button', {
        name: d.agreements.workspace.deletion.confirmAction,
        exact: true,
      })
      .click()
    await expect(fresh).toHaveCount(0)
    await expect(
      page.getByRole('row').filter({ hasText: 'Synthetic terms' }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select id::text from seller_agreement_versions where tenant_id=$1 order by version',
          [f.tenant],
        )
      ).rows.map((row: { id: string }) => row.id),
    ).toEqual([f.agreement])
    const command = { tenantId: f.tenant, agreementId: f.agreement }
    expect(
      (
        await page.request.post('/api/agreements/delete', { data: command })
      ).status(),
    ).toBe(403)
    const refused = await page.request.post('/api/agreements/delete', {
      headers: { origin: new URL(page.url()).origin },
      data: command,
    })
    expect(refused.status()).toBe(200)
    expect(await refused.json()).toMatchObject({
      ok: false,
      usage: { sellers: 1 },
    })
    expect(
      (
        await f.db.query(
          'select count(*)::int as n from seller_agreement_evidence where agreement_id=$1',
          [f.agreement],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
