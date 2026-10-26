import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('downloads a private sale summary and leaves financial facts unchanged', async ({
  page,
  request,
}) => {
  const email = `sale-summary-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Blå kavaj TEST')
    const sale = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual','SUMMARY-TEST',now(),'SEK',$3::jsonb)",
      [f.tenant, sale, JSON.stringify([{ itemId: item, priceOre: 17500 }])],
    )
    const line = (
      await f.db.query('select id from sale_lines where sale_id=$1', [sale])
    ).rows[0].id
    await f.db.query('select record_return($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      line,
      17500,
      'INTERNAL_RETURN_NOTE',
    ])
    await f.commit()
    const before = (
      await f.db.query(
        'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
        [f.tenant],
      )
    ).rows[0].n
    await page.goto(`/intake/sales/${sale}`)
    const link = page.getByRole('link', {
      name: d.saleSummary.download,
      exact: true,
    })
    await expect(link).toBeVisible()
    const path = await link.getAttribute('href')
    const event = page.waitForEvent('download')
    await link.click()
    const download = await event
    expect(download.suggestedFilename()).toBe(`sale-summary-${sale}.pdf`)
    const bytes = await readFile((await download.path())!)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    await download.saveAs(test.info().outputPath('sale-summary.pdf'))
    expect((await request.get(path!)).status()).toBe(401)
    expect(
      (await page.request.get(path!.replace(f.tenant, randomUUID()))).status(),
    ).toBe(409)
    expect(
      (await page.request.get(path!.replace(sale, randomUUID()))).status(),
    ).toBe(404)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(before)
    expect(
      (
        await f.db.query('select total_ore from sales where id=$1', [sale])
      ).rows[0].total_ore.toString(),
    ).toBe('17500')
  } finally {
    await f.close()
  }
})
