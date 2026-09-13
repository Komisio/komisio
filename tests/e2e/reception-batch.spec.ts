import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('AI HTTP fixture splits photos and stages each reviewed garment without duplicate retries', async ({
  page,
  playwright,
}) => {
  test.skip(
    process.env.KOMISIO_TEST_AI_HTTP_FIXTURE !== 'enabled',
    'Dedicated local provider fixture only',
  )
  const email = `batch-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || '{\"assistanceEnabled\":true}'::jsonb)",
      [f.tenant, randomUUID()],
    )
    await f.commit()
    const headers = { Origin: 'http://127.0.0.1:3000' }
    const post = async (data: object) => {
      const r = await page.request.post('/api/intake', {
        headers,
        data: { ...data, tenantId: f.tenant, requestId: randomUUID() },
      })
      expect(r.status(), await r.text()).toBe(200)
      return r.json()
    }
    const { id: sessionId } = await post({
      action: 'createReception',
      sellerId: f.seller,
    })
    const sources = []
    for (const color of ['#cc2222', '#2233cc']) {
      const photoId = randomUUID(),
        png = await sharp({
          create: { width: 32, height: 48, channels: 3, background: color },
        })
          .png()
          .toBuffer()
      const r = await page.request.post(
        `/api/reception/${sessionId}/photo?tenant=${f.tenant}&photo=${photoId}`,
        { headers: { ...headers, 'Content-Type': 'image/png' }, data: png },
      )
      expect(r.status(), await r.text()).toBe(200)
      sources.push((await r.json()).source)
    }
    sources.push({
      id: randomUUID(),
      kind: 'price-evidence',
      reference: 'Synthetic staff appraisal',
      observation: 'Test garment 1: 200.00 SEK; test garment 2: 100.00 SEK',
    })
    await post({
      action: 'saveReceptionSources',
      sessionId,
      expectedRevision: 0,
      sources,
    })
    await page.goto(`/intake/reception/${sessionId}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByLabel(d.reception.batch.mode, { exact: true })
      .selectOption('batch')
    await page
      .getByRole('button', { name: d.reception.aiGenerate, exact: true })
      .click()
    const row1 = page.getByRole('group', {
        name: `${d.reception.batch.garment} 1`,
        exact: true,
      }),
      row2 = page.getByRole('group', {
        name: `${d.reception.batch.garment} 2`,
        exact: true,
      })
    await expect(
      row1.getByText('BATCH HTTP FIXTURE garment 1', { exact: true }),
    ).toBeVisible()
    await expect(
      row2.getByText('BATCH HTTP FIXTURE garment 2', { exact: true }),
    ).toBeVisible()
    await expect(
      row1.getByRole('button', { name: d.reception.batch.stage }),
    ).toBeDisabled()
    await row2
      .getByRole('button', { name: d.reception.batch.dismiss, exact: true })
      .click()
    await expect(
      row2.getByText(d.reception.batch.dismissed, { exact: true }),
    ).toBeVisible()
    await row2
      .getByRole('button', { name: d.reception.batch.restore, exact: true })
      .click()
    let first: object | undefined
    await page.route('**/api/reception/batch', async (route) => {
      const body = route.request().postDataJSON()
      if (body.row === 0 && !first) {
        first = body
        const r = await route.fetch()
        expect(r.status(), await r.text()).toBe(200)
        await route.abort('failed')
      } else {
        if (body.row === 0) expect(body).toEqual(first)
        await route.continue()
      }
    })
    for (const [i, row] of [row1, row2].entries()) {
      await row
        .getByLabel(
          `${d.reception.confirmFact}: ${d.reception.aiFields.description}`,
          { exact: true },
        )
        .check()
      await row.getByLabel(d.reception.confirmPrice, { exact: true }).check()
      await row.getByLabel(d.reception.batch.confirm, { exact: true }).check()
      await row
        .getByRole('button', { name: d.reception.batch.stage, exact: true })
        .click()
      if (i === 0) {
        await expect(row.getByRole('alert')).toBeVisible()
        await row
          .getByRole('button', { name: d.reception.retryButton, exact: true })
          .click()
      }
      await expect(
        row.getByText(d.reception.batch.staged, { exact: true }),
      ).toBeVisible()
    }
    const anonymous = await playwright.request.newContext({
      baseURL: 'http://127.0.0.1:3000',
    })
    try {
      expect(
        (
          await anonymous.post('/api/reception/batch', { headers, data: first })
        ).status(),
      ).toBe(401)
    } finally {
      await anonymous.dispose()
    }
    expect(
      (
        await page.request.post('/api/reception/batch', {
          headers: { Origin: 'https://untrusted.example' },
          data: first,
        })
      ).status(),
    ).toBe(403)
    // Concurrent retries are separate HTTP requests through the real engine.
    const replays = await Promise.all(
      [0, 1].map(() =>
        page.request.post('/api/reception/batch', { headers, data: first }),
      ),
    )
    for (const replay of replays)
      expect(replay.status(), await replay.text()).toBe(200)
    expect(await replays[0].json()).toEqual(await replays[1].json())
    const changed = JSON.parse(JSON.stringify(first))
    changed.candidate.suggestions.metadata.description.value =
      'Changed after staging'
    expect(
      (
        await page.request.post('/api/reception/batch', {
          headers,
          data: changed,
        })
      ).status(),
    ).toBe(409)
    await page.screenshot({
      path: 'test-results/batch-reception-mobile.png',
      fullPage: true,
    })
    const ops = (
      await f.db.query(
        "select id,payload from pending_operations where tenant_id=$1 and kind='publishReceptionReview' order by created_at,id",
        [f.tenant],
      )
    ).rows
    expect(ops).toHaveLength(2)
    expect(
      new Set(
        ops.map(
          (op: { payload: { sessionId: string } }) => op.payload.sessionId,
        ),
      ).size,
    ).toBe(2)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_sessions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(3)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_reviews where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.goto(`/intake/operations/${ops[0].id}`)
    await page
      .getByLabel(
        `${d.operations.confirmField}: ${d.operations.fields.description}`,
        { exact: true },
      )
      .check()
    await page.getByLabel(d.operations.confirmPrice, { exact: true }).check()
    await page.getByLabel(d.operations.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.operations.approve, exact: true })
      .click()
    await expect(
      page.getByText(d.operations.status.executed, { exact: true }),
    ).toBeVisible()
    const child = await page.request.get(
      `/api/reception/${ops[0].payload.sessionId}`,
    )
    expect(
      (await child.json()).latestReview.suggestions.metadata.description
        .certainty,
    ).toBe('observed')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_reviews where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
