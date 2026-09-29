import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function handovers(
  f: Awaited<ReturnType<typeof p2Fixture>>,
  email: string,
) {
  const seller = (
    await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
      f.tenant,
      randomUUID(),
      'Synthetic portal seller',
      email,
      '',
    ])
  ).rows[0].id
  const current = (
    await f.db.query(
      'select id,policy from store_policy_versions where tenant_id=$1 order by version desc limit 1',
      [f.tenant],
    )
  ).rows[0]
  await f.db.query('select publish_store_policy($1,$2,$3,$4::jsonb)', [
    f.tenant,
    randomUUID(),
    current.id,
    JSON.stringify({
      ...current.policy,
      custodySources: ['staff_receipt', 'seller_dropoff'],
    }),
  ])
  await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
    f.tenant,
    randomUUID(),
    seller,
    f.agreement,
    'Synthetic agreement evidence',
  ])
  const ids = [randomUUID(), randomUUID()]
  for (const id of ids)
    await f.db.query(
      "select create_my_handover($1,$2,$3,'bag',1,'Synthetic receiving retry')",
      [f.tenant, id, seller],
    )
  await f.commit()
  return ids
}

test('an unanswered handover can be retried only from its own row', async ({
  page,
}) => {
  const email = `handover-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids = await handovers(f, email)
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/handovers')
    const rows = ids.map((id) => page.locator(`#handover-${id}`))
    await rows[0].locator('summary').click()
    await rows[0]
      .getByLabel(d.handovers.note, { exact: true })
      .fill('Synthetic first bag note')
    await rows[0].getByRole('checkbox').check()
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1)
        await route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      else await route.fulfill({ response })
    })
    await rows[0]
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(page.locator('p[role="alert"]')).toHaveText(d.intake.failed)
    await expect(rows[0].getByRole('checkbox')).toBeDisabled()
    await expect(rows[1].getByRole('checkbox')).toBeEnabled()
    await expect(
      rows[1].getByRole('button', { name: d.handovers.receive, exact: true }),
    ).toBeEnabled()
    await expect(
      rows[1].getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      path: 'private/handover-retry-mobile.png',
      fullPage: true,
      caret: 'initial',
    })
    await rows[0]
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(rows[0].locator('strong')).toContainText(
      d.handovers.statuses.received,
    )
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(commands[0].handoverId).toBe(ids[0])
    expect(commands[0].note).toBe('Synthetic first bag note')
    expect(
      (
        await f.db.query(
          "select count(*)::int n from handover_events where handover_id=$1 and kind='received'",
          [ids[0]],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query('select status from seller_handovers where id=$1', [
          ids[1],
        ])
      ).rows[0].status,
    ).toBe('open')
    await rows[1].getByRole('checkbox').check()
    await rows[1]
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(rows[1].locator('strong')).toContainText(
      d.handovers.statuses.received,
    )
    expect(commands).toHaveLength(3)
    expect(commands[2].handoverId).toBe(ids[1])
    expect(commands[2].requestId).not.toBe(commands[0].requestId)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from handover_events where handover_id=$1 and kind='received'",
          [ids[1]],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

test('a stale handover context offers reload and prevents another receipt', async ({
  page,
}) => {
  const email = `handover-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids = await handovers(f, email)
    await page.goto('/intake/handovers')
    const rows = ids.map((id) => page.locator(`#handover-${id}`))
    await rows[0].getByRole('checkbox').check()
    let requests = 0
    await page.route('**/api/intake', async (route) => {
      requests++
      await route.fulfill({ status: 409, json: { error: 'TENANT_CHANGED' } })
    })
    await rows[0]
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(page.locator('p[role="alert"]')).toHaveText(d.intake.changed)
    for (const row of rows)
      await expect(
        row.getByRole('button', { name: d.handovers.receive, exact: true }),
      ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(rows[0].getByRole('checkbox')).toBeEnabled()
    expect(requests).toBe(1)
  } finally {
    await f.close()
  }
})

for (const status of ['all', 'open'] as const)
  test(`${status}: receiving one handover preserves another row note and confirmation`, async ({
    page,
  }) => {
    const email = `handover-notes-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const ids = await handovers(f, email)
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(`/intake/handovers?status=${status}`)
      const rows = ids.map((id) => page.locator(`#handover-${id}`))
      for (const row of rows) {
        await row.locator('summary').click()
        await row.getByRole('checkbox').check()
      }
      await rows[0]
        .getByLabel(d.handovers.note, { exact: true })
        .fill('Synthetic first bag')
      const secondNote = rows[1].getByLabel(d.handovers.note, { exact: true })
      await secondNote.fill('Synthetic fragile goods in the second bag')
      await rows[0]
        .getByRole('button', { name: d.handovers.receive, exact: true })
        .click()
      // Read the refreshed server summary, not the local success message.
      if (status === 'open') await expect(rows[0]).toHaveCount(0)
      else
        await expect(rows[0].locator('strong')).toContainText(
          d.handovers.statuses.received,
        )
      await expect(secondNote).toBeVisible()
      await expect(secondNote).toHaveValue(
        'Synthetic fragile goods in the second bag',
      )
      await expect(rows[1].getByRole('checkbox')).toBeChecked()
      await rows[1]
        .getByRole('button', { name: d.handovers.receive, exact: true })
        .click()
      if (status === 'open') await expect(rows[1]).toHaveCount(0)
      else
        await expect(rows[1].locator('strong')).toContainText(
          d.handovers.statuses.received,
        )
      expect(
        (
          await f.db.query(
            "select note from handover_events where handover_id=$1 and kind='received'",
            [ids[1]],
          )
        ).rows,
      ).toEqual([{ note: 'Synthetic fragile goods in the second bag' }])
    } finally {
      await f.close()
    }
  })

test('another handover can finish while an uncommitted receipt keeps its own retry', async ({
  page,
}) => {
  const email = `handover-independent-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids = await handovers(f, email)
    await page.goto('/intake/handovers')
    const rows = ids.map((id) => page.locator(`#handover-${id}`))
    await rows[0].locator('summary').click()
    await rows[0]
      .getByLabel(d.handovers.note, { exact: true })
      .fill('Synthetic pending receipt note')
    await rows[0].getByRole('checkbox').check()
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      commands.push(route.request().postDataJSON())
      // A missing answer is uncertain to the UI whether the write ran or not.
      if (commands.length === 1)
        await route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      else await route.continue()
    })
    await rows[0]
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(rows[0].getByRole('alert')).toHaveText(d.intake.failed)
    await rows[1].getByRole('checkbox').check()
    await rows[1]
      .getByRole('button', { name: d.handovers.receive, exact: true })
      .click()
    await expect(rows[1].locator('strong')).toContainText(
      d.handovers.statuses.received,
    )
    expect(commands).toHaveLength(2)
    expect(commands[1].handoverId).toBe(ids[1])
    expect(commands[1].requestId).not.toBe(commands[0].requestId)
    await expect(rows[0].getByRole('alert')).toHaveText(d.intake.failed)
    await expect(
      rows[0].getByLabel(d.handovers.note, { exact: true }),
    ).toHaveValue('Synthetic pending receipt note')
    await expect(rows[0].getByRole('checkbox')).toBeDisabled()
    expect(
      (
        await f.db.query('select status from seller_handovers where id=$1', [
          ids[0],
        ])
      ).rows[0].status,
    ).toBe('open')
    await rows[0]
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(rows[0].locator('strong')).toContainText(
      d.handovers.statuses.received,
    )
    expect(commands).toHaveLength(3)
    expect(commands[2]).toEqual(commands[0])
    for (const id of ids)
      expect(
        (
          await f.db.query(
            "select count(*)::int n from handover_events where handover_id=$1 and kind='received'",
            [id],
          )
        ).rows[0].n,
      ).toBe(1)
  } finally {
    await f.close()
  }
})
