import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller status groups filter the full owned set and preserve search through pages', async ({
  page,
}) => {
  const email = `portal-filter-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    // Bind a new synthetic seller to the verified test account.
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic filter seller',
        email,
        '',
      ])
    ).rows[0].id
    await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      seller,
      f.agreement,
      'Synthetic agreement',
    ])
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        seller,
        '',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    async function item(title: string) {
      return f.asActor(f.actor, async () => {
        const draft = randomUUID(),
          id = randomUUID()
        await f.db.query(
          'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
          [f.tenant, randomUUID(), bag, draft, title, 'Furniture', ''],
        )
        await f.db.query(
          "select accept_item($1,$2,'reception_review',$3,1,20000)",
          [f.tenant, id, draft],
        )
        return id
      })
    }
    const sold: string[] = []
    for (let n = 0; n < 28; n++)
      sold.push(await item(`Archive ${String(n).padStart(2, '0')}`))
    const ended = await item('Ended item')
    await f.asActor(f.actor, () =>
      f.db.query(
        "select end_sale_period($1,$2,$3,'return','Synthetic return')",
        [f.tenant, randomUUID(), ended],
      ),
    )
    await item('Active older')
    await item('Active newer')
    await f.asActor(f.actor, () =>
      f.db.query(
        "select record_sale($1,$2,'manual','FILTER-SALE',now(),'SEK',$3::jsonb)",
        [
          f.tenant,
          randomUUID(),
          JSON.stringify(sold.map((itemId) => ({ itemId, priceOre: 15000 }))),
        ],
      ),
    )
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/seller?seller=${seller}#portal-items`)
    const section = page.locator('#portal-items'),
      rows = section.locator('tbody tr'),
      form = section.getByRole('search')
    const status = section.getByRole('navigation', {
      name: d.sellerPortal.itemsStatus,
      exact: true,
    })
    const tab = (value: 'active' | 'sold' | 'ended') =>
      status
        .getByRole('link')
        .filter({ hasText: d.sellerPortal.itemStatusTabs[value] })
    async function select(value: 'active' | 'sold' | 'ended') {
      await tab(value).click()
      await expect(tab(value)).toHaveAttribute('aria-current', 'page')
    }
    const search = form.getByLabel(d.items.search, { exact: true })
    async function apply() {
      const query = await search.inputValue()
      await form
        .getByRole('button', { name: d.items.searchButton, exact: true })
        .click()
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q') ?? '')
        .toBe(query)
    }
    await expect(tab('active')).toHaveAttribute('aria-current', 'page')
    await expect(tab('active')).toHaveText('Till försäljning (2)')
    await expect(tab('sold')).toHaveText('Sålda (28)')
    await expect(tab('ended')).toHaveText('Avslutade (1)')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Active newer')
    await expect(rows.first().locator('.seller-item-date')).toContainText(
      d.sellerPortal.forSaleUntil,
    )
    await select('sold')
    await search.fill('Archive')
    await apply()
    await expect(rows).toHaveCount(25)
    await expect(rows.first()).toContainText('Archive 27')
    await expect(section.getByText('Visar 1–25 av 28 varor')).toBeVisible()
    await section
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .first()
      .click()
    await expect(rows).toHaveCount(3)
    await expect(rows.first()).toContainText('Archive 02')
    await expect(page).toHaveURL(/q=Archive/)
    await expect(page).toHaveURL(/status=sold/)
    await expect(tab('sold')).toHaveAttribute('aria-current', 'page')
    await expect(rows.first().locator('.seller-item-date')).toContainText(
      d.sellerPortal.soldOn,
    )
    await expect(rows.first().locator('.seller-item-date')).not.toContainText(
      d.sellerPortal.forSaleUntil,
    )
    await expect(search).toHaveValue('Archive')
    await search.fill('Archive 00')
    await apply()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Archive 00')
    await expect(page).not.toHaveURL(/page=2/)
    await select('active')
    await expect(rows).toHaveCount(0)
    await expect(
      section.getByText(d.items.noMatches, { exact: true }),
    ).toBeVisible()
    await search.fill('')
    await apply()
    await expect(search).toHaveValue('')
    await select('ended')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Ended item')
    await expect(rows.first().locator('.seller-item-date')).toContainText(
      d.sellerPortal.endedOn,
    )
    await expect(rows.first().locator('.seller-item-date')).not.toContainText(
      '—',
    )
    await expect(rows.first()).toContainText(d.sellerPortal.endedAs.return)
    const badge = await rows.first().locator('.seller-item-badge').boundingBox()
    const date = await rows
      .first()
      .locator('.seller-item-date time')
      .first()
      .boundingBox()
    expect(badge).not.toBeNull()
    expect(date).not.toBeNull()
    expect(
      Math.abs(badge!.y + badge!.height / 2 - date!.y - date!.height / 2),
    ).toBeLessThan(8)
    await page.screenshot({
      path: test.info().outputPath('seller-ended-date-mobile.png'),
      fullPage: true,
    })

    await select('active')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Active newer')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('seller-status-mobile.png'),
      fullPage: false,
    })
    // A separate empty seller account proves each status-specific empty state.
    let empty = ''
    await f.asActor(f.actor, async () => {
      const another = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Empty portal',
          `empty-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      empty = (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          another,
          randomUUID(),
          'Empty seller',
          email,
          '',
        ])
      ).rows[0].id
    })
    for (const value of ['active', 'sold', 'ended'] as const) {
      await page.goto(`/seller?seller=${empty}&status=${value}#portal-items`)
      await expect(
        section.getByText(d.sellerPortal.itemFilterEmpty[value], {
          exact: true,
        }),
      ).toBeVisible()
      await expect(rows).toHaveCount(0)
    }
  } finally {
    await f.close()
  }
})

test('disabled handovers are hidden without history and read-only with history', async ({
  page,
}) => {
  const email = `portal-handovers-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic handover seller',
        email,
        '',
      ])
    ).rows[0].id
    await f.commit()
    const url = `/seller?seller=${seller}`
    await page.goto(url)
    await expect(page.locator('#portal-handovers')).toHaveCount(0)
    await expect(page.locator('a[href="#portal-handovers"]')).toHaveCount(0)
    async function enable(enabled: boolean) {
      await f.asActor(f.actor, async () => {
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
            custodySources: enabled
              ? ['staff_receipt', 'seller_dropoff']
              : ['staff_receipt'],
          }),
        ])
      })
    }
    await enable(true)
    await page.reload()
    const handovers = page.locator('#portal-handovers')
    await expect(
      handovers.getByText(d.sellerPortal.handoverIntro, { exact: true }),
    ).toBeVisible()
    await expect(
      handovers.getByRole('button', {
        name: d.sellerPortal.announce,
        exact: true,
      }),
    ).toBeVisible()
    await handovers
      .getByRole('button', { name: d.sellerPortal.announce, exact: true })
      .click()
    await expect(handovers.getByText(/^H-\d+$/)).toBeVisible()
    const reference = await handovers.getByText(/^H-\d+$/).innerText()
    await enable(false)
    await page.reload()
    await expect(
      handovers.getByRole('heading', {
        name: d.sellerPortal.handoverHistory,
        exact: true,
      }),
    ).toBeVisible()
    await expect(handovers.getByText(reference, { exact: true })).toBeVisible()
    await expect(handovers).toContainText(d.sellerPortal.handoverStatuses.open)
    await expect(handovers.locator('form')).toHaveCount(0)
    await expect(
      handovers.getByText(d.sellerPortal.handoverIntro, { exact: true }),
    ).toHaveCount(0)
    await expect(
      handovers.getByText(d.sellerPortal.handoverDisabled, { exact: true }),
    ).toHaveCount(0)
    await expect(
      handovers.getByText(d.sellerPortal.none, { exact: true }),
    ).toHaveCount(0)
    await page.goto(url + '#portal-handovers')
    await expect(handovers.getByText(reference, { exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})
