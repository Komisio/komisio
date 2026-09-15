import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('manual labels use the shared renderer and replay one immutable queue job', async ({
  page,
}) => {
  const email = `label-render-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const fixture = await p2Fixture(email)
  try {
    const itemId = await fixture.item('Synthetic label item')
    const printerId = randomUUID()
    await fixture.db.query(
      "select register_printer($1,$2,'Synthetic printer','tcp','127.0.0.1:9100','Synthetic',300,true)",
      [fixture.tenant, printerId],
    )
    await fixture.db.query(
      "select set_label_template($1,'item','Synthetic template',$2)",
      [
        fixture.tenant,
        '^XA^PW{width}^LL{height}^FO10,10^FD{reference} {price}^FS^XZ',
      ],
    )
    await fixture.commit()
    await page.goto('/settings?view=printing')
    const origin = new URL(page.url()).origin
    const input = {
      tenantId: fixture.tenant,
      requestId: randomUUID(),
      printerId,
      kind: 'item',
      referenceKind: 'item',
      referenceId: itemId,
      copies: 2,
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await page.request.post(`${origin}/api/print`, {
        headers: { origin },
        data: input,
      })
      expect(response.status()).toBe(200)
      expect(await response.json()).toEqual({ ok: true, id: input.requestId })
    }
    const jobs = (
      await fixture.db.query(
        'select id,template_version,payload,copies from print_jobs where tenant_id=$1 and id=$2',
        [fixture.tenant, input.requestId],
      )
    ).rows
    expect(jobs).toHaveLength(1)
    expect(jobs[0].template_version).toBe('store-v1')
    expect(jobs[0].copies).toBe(2)
    expect(jobs[0].payload).toContain(`I-${itemId.slice(0, 8).toUpperCase()}`)
    expect(jobs[0].payload).toContain('^PW673^LL378')
    const wrongTenant = await page.request.post(`${origin}/api/print`, {
      headers: { origin },
      data: { ...input, tenantId: randomUUID() },
    })
    expect(wrongTenant.status()).toBe(409)
    const noOrigin = await page.request.post(`${origin}/api/print`, {
      data: input,
    })
    expect(noOrigin.status()).toBe(403)
  } finally {
    await fixture.close()
  }
})
