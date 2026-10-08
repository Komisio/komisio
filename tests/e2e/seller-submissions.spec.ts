import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { register } from '../helpers/account'
test('seller submits photos, receives a request and sends a new immutable version', async ({
  page,
  browser,
}) => {
  const email = `seller-portal-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  const staffContext = await browser.newContext()
  const staff = await staffContext.newPage()
  let sellerId = ''
  try {
    const ownerEmail = `portal-staff-${randomUUID()}@example.test`
    await register(staff, ownerEmail, `K!${randomBytes(16).toString('hex')}`)
    const owner = (
      await db.query('select id from auth.users where email=$1', [ownerEmail])
    ).rows[0].id
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Portal journey',
        `portal-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    sellerId = (
      await db.query('select register_seller($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        'Synthetic seller',
        email,
        '',
      ])
    ).rows[0].id
    const policy = (
      await db.query('select current_store_policy($1) p', [tenant])
    ).rows[0].p
    await db.query('select publish_store_policy($1,$2,$3,$4)', [
      tenant,
      randomUUID(),
      policy.id,
      { ...policy.policy, submissionPricing: 'approval' },
    ])
    await db.query('commit')
    await page.goto(`/seller/submissions?seller=${sellerId}`)

    const photo = await sharp({
      create: { width: 30, height: 30, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer()
    const analysedPhotos: string[][] = []
    await page.route('**/api/seller/submissions/assistance', async (route) => {
      const command = route.request().postDataJSON()
      analysedPhotos.push(command.photos)
      await route.fulfill({
        json: {
          id: command.requestId,
          status: 'ready',
          currency: 'SEK',
          output: {
            description: 'Synthetic AI jacket',
            price: null,
            indicativePrice: analysedPhotos.length === 2 ? '120.00' : '200.00',
            approximatePrice: {
              from: '80.00',
              to: '160.00',
              basis: 'ai_estimate',
            },
            ...(analysedPhotos.length === 2
              ? {}
              : {
                  externalComparison: {
                    from: '150.00',
                    to: '250.00',
                    basis: 'asking',
                    observedAt: new Date().toISOString(),
                    sources: [
                      {
                        url: 'https://example.com/items/1',
                        title: 'Comparable jacket',
                        amount: '150.00',
                      },
                      {
                        url: 'https://example.org/items/2',
                        title: 'Another jacket',
                        amount: '250.00',
                      },
                    ].map((source) => ({
                      ...source,
                      condition: 'Used',
                      status: 'asking',
                      soldAt: null,
                      country: 'SE',
                      currency: 'SEK',
                      priceBasis: 'item_only',
                    })),
                  },
                }),
            suitability: 'uncertain',
            reason: 'Store review needed',
          },
        },
      })
    })
    await page.getByLabel('Bilder', { exact: true }).setInputFiles({
      name: 'jacket.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    })
    await expect(page.getByLabel('Beskrivning', { exact: true })).toHaveValue(
      'Synthetic AI jacket',
    )
    await expect(page.getByText('Cirka 200 kr', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Butiken godkänner ditt prisförslag.'),
    ).toBeVisible()
    await page.getByText('Visa prisunderlag', { exact: true }).click()
    await expect(
      page.getByText(
        'Jämförelse med annonserade priser – inte bekräftade försäljningar.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Comparable jacket' }),
    ).toHaveAttribute('href', 'https://example.com/items/1')
    await page.screenshot({
      path: test.info().outputPath('seller-ai-estimate.png'),
      fullPage: true,
    })
    await expect(page.getByLabel(/Önskat försäljningspris/)).toHaveValue('')
    await page
      .getByRole('button', { name: 'Använd prisförslaget', exact: true })
      .click()
    await expect(page.getByLabel(/Önskat försäljningspris/)).toHaveValue(
      '200.00',
    )
    const firstPath = analysedPhotos[0][0]
    await page
      .getByLabel('Beskrivning', { exact: true })
      .fill('My edited description')
    await page.getByLabel('Bilder', { exact: true }).setInputFiles({
      name: 'label.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    })
    await expect(
      page.getByRole('button', { name: 'Ta bort bild 2', exact: true }),
    ).toBeEnabled()
    await expect(page.getByText('Cirka 120 kr', { exact: true })).toBeVisible()
    await expect(
      page.getByText(
        'Ungefärlig AI-bedömning. Butiken godkänner ditt prisförslag.',
        {
          exact: true,
        },
      ),
    ).toBeVisible()
    expect(analysedPhotos.at(-1)).toHaveLength(2)
    expect(analysedPhotos.at(-1)?.[0]).toBe(firstPath)
    await expect(page.getByLabel('Beskrivning', { exact: true })).toHaveValue(
      'My edited description',
    )
    await page.getByLabel('Bilder', { exact: true }).setInputFiles({
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('invalid'),
    })
    await expect(
      page.getByRole('button', { name: 'Ta bort bild 2', exact: true }),
    ).toBeVisible()
    expect(analysedPhotos).toHaveLength(2)
    await page
      .getByRole('button', { name: 'Ta bort bild 2', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Ta bort bild 1', exact: true }),
    ).toBeEnabled()
    expect(analysedPhotos.at(-1)).toEqual([firstPath])
    await expect(
      page.getByRole('button', { name: 'Ta bort bild 2', exact: true }),
    ).toHaveCount(0)
    await page.unroute('**/api/seller/submissions/assistance')
    await page.getByLabel('Bilder', { exact: true }).setInputFiles({
      name: 'manual.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    })
    await page
      .getByLabel('Beskrivning', { exact: true })
      .fill('Synthetic blue jacket')
    await page.getByLabel(/Önskat försäljningspris/).fill('175')
    await page
      .getByRole('button', { name: 'Skicka till butiken', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Förslaget är skickat.' }),
    ).toHaveText('Förslaget är skickat.')
    await expect(
      page.getByText('Väntar på svar', { exact: true }),
    ).toBeVisible()
    const submission = (
      await db.query('select id from seller_submissions where seller_id=$1', [
        sellerId,
      ])
    ).rows[0].id
    expect(
      (
        await db.query('select photos from seller_submissions where id=$1', [
          submission,
        ])
      ).rows[0].photos,
    ).toHaveLength(2)
    await staff.goto('/intake/submissions')
    await staff
      .getByLabel('Spara besked', { exact: true })
      .selectOption('more_information')
    await staff
      .getByLabel('Meddelande till säljaren')
      .fill('Add a photo of the label')
    await staff
      .getByRole('button', { name: 'Spara besked', exact: true })
      .click()
    await expect(staff.getByText('Komplettera', { exact: true })).toBeVisible()
    await page.reload()
    await page
      .getByRole('link', { name: 'Skicka komplettering', exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`previous=${submission}`))
    await expect(
      page.getByText('Add a photo of the label').first(),
    ).toBeVisible()

    await page.getByLabel('Bilder', { exact: true }).setInputFiles({
      name: 'label.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    })
    await page
      .getByLabel('Beskrivning', { exact: true })
      .fill('Synthetic jacket with label')
    await page.getByLabel(/Önskat försäljningspris/).fill('180')
    await page
      .getByRole('button', { name: 'Skicka komplettering', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Förslaget är skickat.' }),
    ).toHaveText('Förslaget är skickat.')
    await expect(
      page.getByText('Synthetic jacket with label', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Synthetic blue jacket', { exact: true }),
    ).toBeVisible()
    expect(
      (
        await db.query(
          'select count(*)::int n from seller_submissions where seller_id=$1',
          [sellerId],
        )
      ).rows[0].n,
    ).toBe(2)
    await page
      .getByRole('link', { name: 'Skicka in en till vara', exact: true })
      .click()
    await expect(page).toHaveURL(`/seller/submissions?seller=${sellerId}`)
    await expect(
      page.getByRole('button', { name: 'Välj bilder', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Inga bilder valda', { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Beskrivning', { exact: true })).toHaveCount(0)
    await expect(
      page.getByText('Synthetic jacket with label', { exact: true }),
    ).toBeVisible()
    await staff.reload()
    await staff.getByLabel('Godkänn säljarens pris').check()
    await staff
      .getByRole('button', { name: 'Spara besked', exact: true })
      .click()
    await expect(
      staff.getByText('Priset godkänt', { exact: false }),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)
    await page.screenshot({
      path: test.info().outputPath('seller-submissions-mobile.png'),
      fullPage: true,
    })
  } finally {
    await staffContext.close()
    await db.end()
  }
})
