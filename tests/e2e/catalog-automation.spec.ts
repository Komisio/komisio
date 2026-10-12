import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner enables one account, lost save replays, competing workers serialize, and disable revokes a live job', async ({
  page,
}) => {
  const email = `catalog-owner-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const merchant = randomUUID()
  const items = [
    await f.item('Synthetic automatic item one'),
    await f.item('Synthetic automatic item two'),
  ]
  const { Client } = createRequire(import.meta.url)('pg')
  const other = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await other.connect()
  try {
    await f.db.query('select enable_zettle_pull($1,$2)', [f.tenant, merchant])
    await f.db.query('select publish_zettle_catalog_config($1,$2,null,$3)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({ consignment_margin: 0 }),
    ])
    await f.commit()
    let bot = (
      await f.db.query(
        "select id from auth.users where email='automation-e2e@example.test'",
      )
    ).rows[0]?.id
    if (!bot) {
      bot = randomUUID()
      await f.db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'automation-e2e@example.test',now())",
        [bot],
      )
    }
    await page.goto('/intake/integrations?provider=paypal#paypal-products')
    const form = page.getByRole('region', {
      name: d.itemSync.automatic.title,
      exact: true,
    })
    await expect(form.getByRole('status')).toHaveText(d.itemSync.automatic.off)
    const requests: string[] = []
    await page.route(
      '**/api/integrations/catalog-automation',
      async (route) => {
        const body = route.request().postDataJSON()
        expect(body).toMatchObject({
          tenantId: f.tenant,
          provider: 'paypal',
          connectionId: merchant,
          enabled: true,
        })
        requests.push(body.requestId)
        const response = await route.fetch()
        if (requests.length === 1) await route.abort('connectionreset')
        else await route.fulfill({ response })
      },
    )
    await form
      .getByRole('button', { name: d.itemSync.automatic.enable, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(
      d.itemSync.preferences.uncertain,
    )
    await form
      .getByRole('button', { name: d.itemSync.retry, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.itemSync.automatic.on)
    expect(requests).toHaveLength(2)
    expect(requests[0]).toBe(requests[1])
    expect(
      (
        await f.db.query(
          'select count(*) from catalog_automation_revisions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe('1')
    await page.unroute('**/api/integrations/catalog-automation')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await form.screenshot({ path: 'private/catalog-automation-mobile.png' })

    await f.asActor(bot, () => f.db.query('select accept_automation_grants()'))
    await f.db.query('begin')
    await f.db.query('set local role authenticated')
    const claims = JSON.stringify({ sub: bot, role: 'authenticated' })
    await f.db.query("select set_config('request.jwt.claims',$1,true)", [
      claims,
    ])
    const jobId = randomUUID()
    const first = (
      await f.db.query("select claim_catalog_export($1,$2,'paypal') job", [
        f.tenant,
        jobId,
      ])
    ).rows[0].job
    expect(items).toContain(first.itemId)
    await other.query('begin')
    await other.query('set local role authenticated')
    await other.query("select set_config('request.jwt.claims',$1,true)", [
      claims,
    ])
    const competing = other.query(
      "select claim_catalog_export($1,$2,'paypal') job",
      [f.tenant, randomUUID()],
    )
    await f.db.query('commit')
    expect((await competing).rows[0].job).toBeNull()
    await other.query('commit')
    await f.asActor(bot, async () => {
      expect(
        (
          await f.db.query("select claim_catalog_export($1,$2,'paypal') job", [
            f.tenant,
            jobId,
          ])
        ).rows[0].job,
      ).toBeNull()
      await f.db.query("select finish_catalog_export($1,$2,'held')", [
        f.tenant,
        jobId,
      ])
      const second = (
        await f.db.query("select claim_catalog_export($1,$2,'paypal') job", [
          f.tenant,
          randomUUID(),
        ])
      ).rows[0].job
      expect(items).toContain(second.itemId)
      expect(second.itemId).not.toBe(first.itemId)
    })
    await form
      .getByRole('button', { name: d.itemSync.automatic.disable, exact: true })
      .click()
    await expect(form.getByRole('status')).toContainText(
      d.itemSync.automatic.off,
    )
    await f.asActor(bot, async () => {
      for (const item of items)
        expect(
          (
            await f.db.query(
              'select catalog_export_item_access($1,$2) allowed',
              [f.tenant, item],
            )
          ).rows[0].allowed,
        ).toBe(false)
    })
    expect(
      (
        await f.db.query(
          'select count(*) from integration_sync_preference_revisions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe('0')
  } finally {
    await other.query('rollback')
    await other.end()
    await f.close()
  }
})
