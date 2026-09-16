import { register, confirmEmail } from '../helpers/account'
import { test, expect, type Page } from '@playwright/test'
import { randomBytes, createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import sharp from 'sharp'

test('saved inspection drafts resume safely and preserve conflicting edits', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `inspection-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Inspection')
  await page.getByLabel('Butikens identifierare').fill(`inspection-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Inspection TEST',
    email: '',
    phone: '00000',
  })
  expect(seller.status()).toBe(200)
  const received = await post({
    action: 'receiveBag',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
    note: 'Synthetic bag',
    expectedAgreementId: null,
  })
  expect(received.status()).toBe(200)
  const bagId = (await received.json()).id
  const path = `/intake/bags/${bagId}/inspect`
  await page.goto(path)
  await page
    .getByLabel('Beskrivning av varan')
    .fill('TEST blå jacka <script>literal</script>')
  await page.getByLabel('Kategori (valfritt)').fill('Kläder')
  await page
    .getByLabel('Skick och anmärkningar (valfritt)')
    .fill('Litet hål i ärmen')
  await expect(page.getByText('Du har osparade ändringar.')).toBeVisible()
  let stored: Record<string, unknown> | undefined
  await page.route(
    '**/api/intake',
    async (route) => {
      stored = route.request().postDataJSON()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Spara utkast', exact: true }).click()
  await expect(page.locator('.form-error')).toBeVisible()
  await expect(page.getByLabel('Beskrivning av varan')).toBeDisabled()
  await page.getByRole('button', { name: 'Spara utkast', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(
    'Varuutkastet är sparat.',
  )
  await expect(page.locator('.inspection-item')).toHaveCount(1)
  await expect(page.getByText('Inga varuutkast är sparade ännu.')).toHaveCount(
    0,
  )
  await page.getByRole('link', { name: 'Öppna sparat utkast' }).click()
  await expect(page.getByLabel('Beskrivning av varan')).toHaveValue(
    'TEST blå jacka <script>literal</script>',
  )
  await page.reload()
  await expect(
    page.getByLabel('Skick och anmärkningar (valfritt)'),
  ).toHaveValue('Litet hål i ärmen')
  await expect(page.locator('.inspection-item')).toHaveCount(1)
  const preparation = page.locator('.inspection-preparation')
  await preparation.locator('summary').click()
  await expect(preparation).toContainText(
    'TEST blå jacka <script>literal</script>',
  )
  await expect(preparation).toContainText('Osparade ändringar ingår inte')
  await expect(preparation.getByRole('button')).toHaveCount(0)
  const stale = await page.context().newPage()
  try {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await stale.route('**/_next/static/**/*.js', async (route) => {
      await gate
      await route.continue()
    })
    try {
      await stale.goto(page.url(), { waitUntil: 'commit' })
      await expect(stale.getByLabel('Beskrivning av varan')).toBeDisabled()
    } finally {
      release()
    }
    await expect(stale.getByLabel('Beskrivning av varan')).toBeEnabled()
    await stale
      .getByLabel('Beskrivning av varan')
      .fill('Min osparade alternativa beskrivning')
    await page.getByLabel('Beskrivning av varan').fill('TEST blå bomullsjacka')
    await expect(preparation).toContainText(
      'TEST blå jacka <script>literal</script>',
    )
    await expect(preparation).not.toContainText('TEST blå bomullsjacka')
    await page
      .getByRole('button', { name: 'Spara utkast', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(
      'Varuutkastet är sparat.',
    )
    await stale
      .getByRole('button', { name: 'Spara utkast', exact: true })
      .click()
    await expect(stale.locator('.form-error')).toContainText(
      'Utkastet har ändrats',
    )
    await expect(stale.getByLabel('Beskrivning av varan')).toHaveValue(
      'Min osparade alternativa beskrivning',
    )
    await expect(
      stale.getByRole('button', { name: 'Spara utkast', exact: true }),
    ).toBeDisabled()
    expect((await post(stored!)).status()).toBe(200)
    await page.getByRole('link', { name: 'Öppna sparat utkast' }).click()
    await expect(page.getByLabel('Beskrivning av varan')).toHaveValue(
      'TEST blå bomullsjacka',
    )
    await expect(page.locator('.inspection-item')).toHaveCount(1)
    await expect(page.locator('.inspection-item')).toContainText(
      'Sparad version 2',
    )
    const selectedDraft = String(stored!.draftId)
    await page
      .locator('.inspection-history')
      .getByRole('link', { name: 'Sparad version 1', exact: true })
      .click()
    await expect(page.locator('.inspection-historical')).toContainText(
      'TEST blå jacka <script>literal</script>',
    )
    await expect(page.getByLabel('Beskrivning av varan')).toHaveCount(0)
    await expect(page.locator('.inspection-preparation')).toHaveCount(0)
    await expect(
      page.getByText('TEST blå bomullsjacka', { exact: true }).last(),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Öppna aktuellt utkast' }).click()
    await expect(page.getByLabel('Beskrivning av varan')).toHaveValue(
      'TEST blå bomullsjacka',
    )
    // More than one page of immutable revisions and distinct drafts.
    for (let revision = 2; revision < 22; revision++) {
      expect(
        (
          await post({
            action: 'saveInspection',
            tenantId,
            requestId: crypto.randomUUID(),
            bagId,
            draftId: selectedDraft,
            expectedRevision: revision,
            fields: {
              description: `TEST historical revision ${revision + 1}`,
              category: '',
              condition: '',
            },
          })
        ).status(),
      ).toBe(200)
    }
    await page.goto(`${path}?draft=${selectedDraft}`)
    await expect(page.locator('.inspection-history li')).toHaveCount(20)
    await page.getByRole('link', { name: 'Äldre versioner' }).click()
    await expect(page.locator('.inspection-history li')).toHaveCount(2)
    await page
      .locator('.inspection-history')
      .getByRole('link', { name: 'Sparad version 1', exact: true })
      .click()
    await expect(page.locator('.inspection-historical')).toContainText(
      'TEST blå jacka <script>literal</script>',
    )
    for (let item = 0; item < 21; item++) {
      expect(
        (
          await post({
            action: 'saveInspection',
            tenantId,
            requestId: crypto.randomUUID(),
            bagId,
            draftId: crypto.randomUUID(),
            expectedRevision: 0,
            fields: {
              description: `TEST paged item ${item}`,
              category: '',
              condition: '',
            },
          })
        ).status(),
      ).toBe(200)
    }
    await page.goto(path)
    await expect(page.locator('.inspection-item')).toHaveCount(20)
    const firstPage = await page.locator('.inspection-item a').allTextContents()
    await page.getByRole('link', { name: 'Nästa varor' }).click()
    await expect(page.locator('.inspection-item')).toHaveCount(2)
    const lastPage = await page.locator('.inspection-item a').allTextContents()
    expect(new Set([...firstPage, ...lastPage]).size).toBe(22)
    await page.getByRole('link', { name: 'Föregående varor' }).click()
    await expect(page.locator('.inspection-item')).toHaveCount(20)
    expect(await page.locator('.inspection-item a').allTextContents()).toEqual(
      firstPage,
    )
    await page.goto(`${path}?draft=${selectedDraft}&version=1`)
    await expect(page.locator('.inspection-historical')).toContainText(
      'TEST blå jacka <script>literal</script>',
    )
    await page.goto(`${path}?draft=${selectedDraft}&version=999`)
    await expect(page.locator('.inspection-historical')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Spara utkast', exact: true }),
    ).toHaveCount(0)
    await page.goto(`${path}?draft=${selectedDraft}&version=1`)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.inspection-historical')).toContainText(
      'TEST blå jacka <script>literal</script>',
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'test-results/inspection-mobile.png',
      fullPage: true,
    })
    await page
      .locator('.inspection-historical')
      .screenshot({ path: 'test-results/inspection-history-mobile.png' })
  } finally {
    await stale.close()
  }
})

test('versioned agreement evidence gates new receipts and preserves old ones', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `agreements-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Avtalsbutiken')
  await page.getByLabel('Butikens identifierare').fill(`agreements-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  await page.goto('/intake/agreements')
  await page.getByLabel('Avtalets rubrik').fill('TEST Villkor 1')
  await page
    .getByLabel('Avtalstext', { exact: true })
    .fill('Endast fiktiva testvillkor. <script>Not executable</script>')
  await page.getByLabel('Kräv registrerat underlag', { exact: false }).check()
  await page.getByLabel('Jag har granskat texten', { exact: false }).check()
  const publishResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Publicera version', exact: true })
    .click()
  const published = await publishResponse
  expect(published.status()).toBe(200)
  const version1 = (await published.json()).id
  await expect(page.getByRole('status')).toContainText(
    'Avtalsversionen är publicerad',
  )
  await expect(page.locator('.agreement-text')).toContainText(
    '<script>Not executable</script>',
  )
  await page.goto('/intake')
  await page.getByLabel('Säljarens namn').fill('Avtalssäljare TEST')
  await page.getByLabel('Telefon', { exact: true }).fill('0000000000')
  await page.getByRole('button', { name: 'Spara säljare' }).click()
  await expect(
    page.getByRole('heading', { name: 'Ta emot en påse' }),
  ).toBeVisible()
  const sellerUrl = page.url()
  const sellerId = new URL(sellerUrl).searchParams.get('seller')!
  await expect(
    page.getByRole('button', { name: 'Bekräfta mottagandet' }),
  ).toBeDisabled()
  const denied = await page.request.post('/api/intake', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'receiveBag',
      tenantId,
      sellerId,
      requestId: crypto.randomUUID(),
      note: '',
      expectedAgreementId: version1,
    },
  })
  expect(denied.status()).toBe(409)
  expect((await denied.json()).error).toBe('AGREEMENT_REQUIRED')
  await page
    .getByLabel('Hänvisning till underlag', { exact: true })
    .fill('TEST-PAPPER-1, fiktivt underlag')
  await page
    .getByLabel('Jag har kontrollerat att underlaget', { exact: false })
    .check()
  await page
    .getByRole('button', { name: 'Registrera underlag', exact: true })
    .click()
  await expect(
    page.getByText('Underlag finns för aktuell version', { exact: true }),
  ).toBeVisible()
  await page.getByLabel('Jag bekräftar att påsen', { exact: false }).check()
  const receiptResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Bekräfta mottagandet' }).click()
  const receipt = await receiptResponse
  expect(receipt.status()).toBe(200)
  const receiptId = (await receipt.json()).id
  const replayCommand = receipt.request().postDataJSON()
  await expect(page.locator('.intake-bag')).toHaveCount(1)
  const stale = await page.context().newPage()
  const stalePublisher = await page.context().newPage()
  try {
    await stalePublisher.goto('/intake/agreements')
    await stalePublisher
      .getByLabel('Avtalets rubrik')
      .fill('Unpublished older draft')
    await stalePublisher
      .getByLabel('Jag har granskat texten', { exact: false })
      .check()
    await stale.goto(sellerUrl)
    await stale
      .getByLabel('Kännetecken på påsen (valfritt)')
      .fill('Stale form bag')
    await stale.getByLabel('Jag bekräftar att påsen', { exact: false }).check()
    await page.goto('/intake/agreements')
    await page.getByLabel('Avtalets rubrik').fill('TEST Villkor 2')
    await page
      .getByLabel('Avtalstext', { exact: true })
      .fill('New fictional terms, not a real seller contract.')
    await page.getByLabel('Avtalets språk').selectOption('en')
    await page.getByLabel('Jag har granskat texten', { exact: false }).check()
    await page
      .getByRole('button', { name: 'Publicera version', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(
      'Avtalsversionen är publicerad',
    )
    await stalePublisher
      .getByRole('link', { name: /Version 1.*TEST Villkor 1/ })
      .click()
    await expect(stalePublisher).toHaveURL(/version=/)
    await expect(stalePublisher.getByLabel('Avtalets rubrik')).toHaveValue(
      'Unpublished older draft',
    )
    await stalePublisher
      .getByRole('button', { name: 'Publicera version', exact: true })
      .click()
    await expect(
      stalePublisher
        .getByRole('alert')
        .filter({ hasText: 'Avtalet har ändrats' }),
    ).toBeVisible()
    await stale.getByRole('button', { name: 'Bekräfta mottagandet' }).click()
    await expect(
      stale.getByRole('alert').filter({ hasText: 'Avtalet har ändrats' }),
    ).toBeVisible()
    await expect(
      stale.getByRole('button', { name: 'Bekräfta mottagandet' }),
    ).toBeDisabled()
    const replay = await page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: replayCommand,
    })
    expect(replay.status()).toBe(200)
    expect((await replay.json()).id).toBe(receiptId)
    await page.goto(`/intake/bags/${receiptId}`)
    await expect(
      page.getByRole('link', { name: 'TEST Villkor 1 · Version 1' }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Registrerat av personal: TEST-PAPPER-1, fiktivt underlag',
      ),
    ).toBeVisible()
    await expect(page.locator('.bag-label')).not.toContainText('TEST-PAPPER-1')
    await page.goto(sellerUrl)
    await expect(
      page.getByText('Underlag saknas för aktuell version', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Bekräfta mottagandet' }),
    ).toBeDisabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: 'test-results/agreement-intake-mobile.png',
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await stale.close()
    await stalePublisher.close()
  }
})

test('staff receives a bag, retries safely and prints a private label', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `intake-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Påsmottagning')
  await page.getByLabel('Butikens identifierare').fill(`intake-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  await page.goto('/intake')
  await page.getByLabel('Säljarens namn').fill('Test Säljare')
  await page.getByLabel('E-post', { exact: true }).fill('seller@example.test')
  await page.getByRole('button', { name: 'Spara säljare' }).click()
  await expect(
    page.getByRole('heading', { name: 'Ta emot en påse' }),
  ).toBeVisible()
  await page.getByLabel('Kännetecken på påsen (valfritt)').fill('Blå tygpåse')
  await page.getByRole('checkbox').check()
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Bekräfta mottagandet' }).click()
  const response = await saved
  expect(response.status()).toBe(200)
  const original = response.request().postDataJSON()
  const replay = await page.request.post('/api/intake', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: original,
  })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).id).toBe((await response.json()).id)
  const conflict = await page.request.post('/api/intake', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { ...original, note: 'Changed' },
  })
  expect(conflict.status()).toBe(409)
  const stale = await page.request.post('/api/intake', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { ...original, tenantId: '10000000-0000-4000-8000-000000000001' },
  })
  expect(stale.status()).toBe(409)
  expect(original.tenantId).toBe(tenantId)
  await expect(page.getByRole('status')).toContainText('Påsen är registrerad')
  await expect(page.locator('.intake-bag')).toHaveCount(1)
  await page
    .getByRole('status')
    .getByRole('link', { name: 'Visa etikett' })
    .click()
  await expect(page.locator('.bag-label')).toContainText('E2E Påsmottagning')
  await expect(page.locator('.bag-label')).not.toContainText(
    'seller@example.test',
  )
  await expect(page.locator('.bag-label')).not.toContainText('Test Säljare')
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = 'yes'
    }
  })
  await page.getByRole('button', { name: 'Skriv ut etikett' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.bag-label')).toBeVisible()
  await page.screenshot({ path: 'test-results/bag-label.png', fullPage: true })
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('link', { name: 'Till inlämningar' }).click()
  await expect(page).toHaveURL(/\/intake$/)
  await page.reload()
  await expect(page.locator('.intake-bag')).toHaveCount(1)
  await page.getByRole('link').filter({ hasText: 'Test Säljare' }).click()
  await expect(
    page.getByRole('heading', { name: 'Ta emot en påse' }),
  ).toBeVisible()
  await page
    .getByLabel('Kännetecken på påsen (valfritt)')
    .fill('Lost response bag')
  await page.getByRole('checkbox').check()
  let loseResponse = true
  await page.route('**/api/intake', async (route) => {
    if (loseResponse) {
      loseResponse = false
      const persisted = await route.fetch()
      expect(persisted.status()).toBe(200)
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Bekräfta mottagandet' }).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Det gick inte att bekräfta resultatet' }),
  ).toBeVisible()
  await expect(
    page.getByLabel('Kännetecken på påsen (valfritt)'),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Försök igen' }).click()
  await expect(page.getByRole('status')).toContainText('Påsen är registrerad')
  await expect(page.locator('.intake-bag')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/intake-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('invalid callbacks stay local and anonymous writes are denied', async ({
  page,
}) => {
  await page.goto('/login')
  await page.screenshot({
    path: 'test-results/platform-login.png',
    caret: 'initial',
    fullPage: true,
  })
  const denied = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { action: 'profile', name: 'Anonymous', locale: 'sv' },
  })
  expect(denied.status()).toBe(401)
  await page.goto('/auth/callback?code=invalid&next=https%3A%2F%2Fexample.org')
  await expect(page).toHaveURL('http://127.0.0.1:3000/login?error=callback')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Länken kunde inte användas.' }),
  ).toBeVisible()
})

test('failed confirmation preserves a safe invitation destination', async ({
  page,
}) => {
  const invitationPath = `/invite/${'a'.repeat(64)}`
  await page.goto(
    `/auth/callback?code=invalid&next=${encodeURIComponent(invitationPath)}`,
  )
  const destination = new URL(page.url())
  expect(destination.pathname).toBe('/login')
  expect(destination.searchParams.get('error')).toBe('callback')
  expect(destination.searchParams.get('next')).toBe(invitationPath)
  await expect(
    page.getByRole('link', { name: 'Skapa konto', exact: true }),
  ).toHaveAttribute(
    'href',
    `/register?next=${encodeURIComponent(invitationPath)}`,
  )
  await expect(
    page.getByText('Logga in med den e-postadress som fick inbjudan.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Skapa konto', exact: true }).click()
  await expect(
    page.getByText('Du har följt en butiksinbjudan.', { exact: false }),
  ).toBeVisible()
  await page.locator('.locale-switch select').selectOption('en')
  await expect(
    page.getByText('You followed a store invitation.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', `/login?next=${encodeURIComponent(invitationPath)}`)
})

test('anonymous invitation uses the selected language', async ({ page }) => {
  await page.goto('/login')
  await page.locator('.locale-switch select').selectOption('en')
  await page.goto(`/invite/${'b'.repeat(64)}`)
  await expect(
    page.getByRole('heading', { name: "You're invited.", exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Create account', exact: true }).click()
  await expect(
    page.getByText('You followed a store invitation.', { exact: false }),
  ).toBeVisible()
})

test('selected English survives confirmation and store creation', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await page.goto('/register')
  await page.locator('.locale-switch select').selectOption('en')
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`english-${run}@example.test`)
  await page
    .getByLabel('Password', { exact: true })
    .fill(`K!${randomBytes(16).toString('hex')}`)
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click()
  await expect(
    page.getByText('Check your email and follow the link', { exact: false }),
  ).toBeVisible()
  await confirmEmail(page, `english-${run}@example.test`)
  await expect(page.getByLabel('Store name', { exact: true })).toBeVisible()
  await page.getByLabel('Store name', { exact: true }).fill('E2E English Store')
  await page
    .getByLabel('Store identifier', { exact: true })
    .fill(`english-${run}`)
  await page
    .getByRole('button', { name: 'Create my store', exact: true })
    .click()
  await expect(page.getByLabel('Active store').first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Active store').first()).toBeVisible()
  await page.goto('/account')
  await page.getByLabel('Language', { exact: true }).selectOption('sv')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Mitt konto', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Mitt konto', exact: true }),
  ).toBeVisible()
})

test('register, verify, create stores, invite, isolate and administer access', async ({
  browser,
  page,
}) => {
  const run = Date.now().toString(36)
  const email = `owner-${run}@example.test`,
    staffEmail = `staff-${run}@example.test`
  const password = `K!${randomBytes(16).toString('hex')}`
  await page.goto('/members')
  await expect(page).toHaveURL(/\/login/)
  await register(page, email, password)
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel('Butikens namn').fill('E2E Gröna Garderoben')
  await page.getByLabel('Butikens namn').press('Tab')
  const storeIdentifier = page.getByLabel('Butikens identifierare')
  await expect(storeIdentifier).toBeFocused()
  await expect(storeIdentifier).toHaveAccessibleDescription(
    'Små bokstäver, siffror och bindestreck. Till exempel min-secondhand.',
  )
  await storeIdentifier.fill(`garden-${run}`)
  await storeIdentifier.press('Enter')
  await expect(page.getByRole('heading', { name: 'Välkommen.' })).toBeVisible()
  const tenantA = await page.getByLabel('Aktiv butik').first().inputValue()
  await page.goto('/account')
  await page.getByLabel('Ditt namn').fill('Alex')
  await page
    .getByRole('button', { name: 'Spara ändringar', exact: true })
    .click()
  await expect(page.getByText('Ändringarna har sparats.')).toBeVisible()
  await page.goto('/members')
  await page.getByLabel('E-postadress', { exact: true }).fill(staffEmail)
  await page.getByRole('button', { name: 'Bjud in', exact: true }).click()
  await expect(
    page.getByText('Inbjudningslänken är klar', { exact: true }),
  ).toBeVisible()
  const supersededInvite = await page
    .getByRole('textbox', { name: 'Inbjudningslänken är klar' })
    .inputValue()
  await expect(
    page.getByText(
      'Dela länken med mottagaren. Automatisk e-post är inte aktiverad.',
    ),
  ).toBeVisible()
  // A replacement invalidates the earlier link, but not the recipient's account.
  await page.getByRole('button', { name: 'Bjud in', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: 'Inbjudningslänken är klar' }),
  ).not.toHaveValue(supersededInvite)
  const invite = await page
    .getByRole('textbox', { name: 'Inbjudningslänken är klar' })
    .inputValue()
  const wrongIdentity = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'accept',
      token: new URL(invite).pathname.split('/').pop(),
    },
  })
  expect(wrongIdentity.status()).toBe(400)
  expect((await wrongIdentity.json()).error).toBe('INVITATION_INVALID')
  const staffContext = await browser.newContext()
  const staff = await staffContext.newPage()
  await register(
    staff,
    staffEmail,
    password,
    new URL(supersededInvite).pathname,
  )
  await staff
    .getByRole('button', { name: 'Acceptera inbjudan', exact: true })
    .click()
  await expect(
    staff.getByRole('alert').filter({ hasText: 'Inbjudan är ogiltig' }),
  ).toBeVisible()
  await expect(
    staff.getByText('Öppna den senaste inbjudan', { exact: false }),
  ).toBeVisible()
  await staff.setViewportSize({ width: 390, height: 844 })
  await staff.screenshot({
    path: 'test-results/invitation-recovery-mobile.png',
    fullPage: true,
  })
  await staff.getByRole('button', { name: 'Logga ut', exact: true }).click()
  await expect(staff).toHaveURL(new RegExp('/login\\?next='))
  expect(new URL(staff.url()).searchParams.get('next')).toBe(
    new URL(supersededInvite).pathname,
  )
  await staff.getByLabel('E-postadress', { exact: true }).fill(staffEmail)
  await staff.getByLabel('Lösenord', { exact: true }).fill(password)
  await staff.getByRole('button', { name: 'Logga in', exact: true }).click()
  await expect(staff).toHaveURL(supersededInvite)
  await staff.goto(invite)
  await expect(
    staff.getByRole('button', { name: 'Acceptera inbjudan', exact: true }),
  ).toBeVisible()
  await staff
    .getByRole('button', { name: 'Acceptera inbjudan', exact: true })
    .click()
  await expect(staff.getByRole('heading', { name: 'Välkommen.' })).toBeVisible()
  const replay = await staff.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'accept',
      token: new URL(invite).pathname.split('/').pop(),
    },
  })
  expect(replay.status()).toBe(400)
  expect((await replay.json()).error).toBe('INVITATION_INVALID')
  await staff.goto('/members')
  await expect(
    staff.getByText('Du kan se vilka som arbetar här.'),
  ).toBeVisible()
  const staffDenied = await staff.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'invite',
      tenantId: tenantA,
      email: `intruder-${run}@example.test`,
      role: 'admin',
    },
  })
  expect(staffDenied.status()).toBe(403)
  await page.reload()
  await expect(
    page.getByText(staffEmail, { exact: true }).first(),
  ).toBeVisible()
  await page.goto('/onboarding')
  await page.getByLabel('Butikens namn').fill('E2E Andra Butiken')
  await page.getByLabel('Butikens identifierare').fill(`second-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(
    page.getByRole('heading', { name: 'Välkommen, Alex' }),
  ).toBeVisible()
  const tenantB = await page.getByLabel('Aktiv butik').first().inputValue()
  expect(tenantB).not.toBe(tenantA)
  const crossTenant = await staff.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { action: 'select', tenantId: tenantB },
  })
  expect(crossTenant.ok()).toBe(false)
  const stale = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { action: 'rename', tenantId: tenantA, name: 'Wrong tab' },
  })
  expect(stale.status()).toBe(409)
  await page.getByLabel('Aktiv butik').first().selectOption(tenantA)
  await expect(page.locator('.page-heading .eyebrow')).toHaveText(
    'E2E Gröna Garderoben',
  )
  await page.screenshot({
    path: 'test-results/platform-desktop.png',
    fullPage: true,
  })
  await page.goto('/members')
  const staffRow = page
    .getByRole('row')
    .filter({ has: page.getByText(staffEmail, { exact: true }) })
  await staffRow.getByRole('button', { name: /Ta bort tillgång/ }).click()
  await page.getByRole('button', { name: 'Bekräfta', exact: true }).click()
  await expect(page.getByText('Ändringarna har sparats.')).toBeVisible()
  await staff.goto('/')
  await expect(staff).toHaveURL(/\/onboarding/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Välkommen, Alex' }),
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/platform-mobile.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/account')
  await page.getByLabel('Språk', { exact: true }).selectOption('en')
  await page
    .getByRole('button', { name: 'Spara ändringar', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'My account', exact: true }),
  ).toBeVisible()
  await staffContext.close()
})

test('admin and readonly permissions stay scoped to each store', async ({
  browser,
  page,
}) => {
  const run = Date.now().toString(36)
  const password = `K!${randomBytes(16).toString('hex')}`
  const adminEmail = `admin-${run}@example.test`
  const readerEmail = `reader-${run}@example.test`
  const adminContext = await browser.newContext()
  const readerContext = await browser.newContext()
  const admin = await adminContext.newPage()
  const reader = await readerContext.newPage()
  async function command(actor: Page, data: object) {
    return actor.request.post('/api/platform', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  }
  try {
    await register(page, `roles-owner-${run}@example.test`, password)
    await page.getByLabel('Butikens namn').fill('E2E Role Store')
    await page.getByLabel('Butikens identifierare').fill(`roles-${run}`)
    await page.getByRole('button', { name: 'Skapa min butik' }).click()
    await expect(
      page.getByRole('heading', { name: 'Välkommen.' }),
    ).toBeVisible()
    const tenantA = await page.getByLabel('Aktiv butik').first().inputValue()
    const invitation = await command(page, {
      action: 'invite',
      tenantId: tenantA,
      email: adminEmail,
      role: 'admin',
    })
    expect(invitation.ok()).toBe(true)
    const adminInvite = (await invitation.json()).inviteUrl
    await register(admin, adminEmail, password, new URL(adminInvite).pathname)
    await admin
      .getByRole('button', { name: 'Acceptera inbjudan', exact: true })
      .click()
    await expect(
      admin.getByRole('heading', { name: 'Välkommen.' }),
    ).toBeVisible()
    await admin.goto('/members')
    await expect(
      admin.getByLabel('Roll', { exact: true }).locator('option'),
    ).toHaveCount(2)
    expect(
      (
        await command(admin, {
          action: 'invite',
          tenantId: tenantA,
          email: `elevated-${run}@example.test`,
          role: 'admin',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await command(admin, {
          action: 'rename',
          tenantId: tenantA,
          name: 'E2E Admin Renamed',
        })
      ).ok(),
    ).toBe(true)
    const readerInvitation = await command(admin, {
      action: 'invite',
      tenantId: tenantA,
      email: readerEmail,
      role: 'readonly',
    })
    expect(readerInvitation.ok()).toBe(true)
    await register(
      reader,
      readerEmail,
      password,
      new URL((await readerInvitation.json()).inviteUrl).pathname,
    )
    await reader
      .getByRole('button', { name: 'Acceptera inbjudan', exact: true })
      .click()
    await expect(
      reader.getByRole('heading', { name: 'Välkommen.' }),
    ).toBeVisible()
    await reader.goto('/members')
    await expect(
      reader.getByRole('button', { name: 'Bjud in', exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await command(reader, {
          action: 'rename',
          tenantId: tenantA,
          name: 'Forbidden rename',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await command(reader, {
          action: 'invite',
          tenantId: tenantA,
          email: `denied-${run}@example.test`,
          role: 'staff',
        })
      ).status(),
    ).toBe(403)
    await reader.goto('/onboarding')
    await reader.getByLabel('Butikens namn').fill('E2E Reader Own Store')
    await reader.getByLabel('Butikens identifierare').fill(`reader-own-${run}`)
    await reader.getByRole('button', { name: 'Skapa min butik' }).click()
    await expect(
      reader.getByRole('heading', { name: 'Välkommen.' }),
    ).toBeVisible()
    const tenantB = await reader.getByLabel('Aktiv butik').first().inputValue()
    expect(tenantB).not.toBe(tenantA)
    expect(
      (
        await command(reader, {
          action: 'rename',
          tenantId: tenantB,
          name: 'E2E Owner Rename',
        })
      ).ok(),
    ).toBe(true)
    expect(
      (await command(admin, { action: 'select', tenantId: tenantB })).ok(),
    ).toBe(false)
    await reader.getByLabel('Aktiv butik').first().selectOption(tenantA)
    await expect(reader.locator('.page-heading .eyebrow')).toHaveText(
      'E2E Admin Renamed',
    )
    expect(
      (
        await command(reader, {
          action: 'rename',
          tenantId: tenantA,
          name: 'Still forbidden',
        })
      ).status(),
    ).toBe(403)
  } finally {
    await adminContext.close()
    await readerContext.close()
  }
})

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = secret
    .replace(/=+$/, '')
    .toUpperCase()
    .split('')
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[19] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0')
}
test('password recovery and MFA protect the authenticated platform', async ({
  page,
}) => {
  const run = Date.now().toString(36),
    email = `security-${run}@example.test`
  const password = `K!${randomBytes(16).toString('hex')}`,
    newPassword = `K!${randomBytes(16).toString('hex')}`
  await register(page, email, password)
  await expect(
    page.getByRole('heading', { name: 'Ge din butik en plats.' }),
  ).toBeVisible()
  await page.goto('/account')
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/reset-password')
  await page.getByLabel('E-postadress', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Skicka återställningslänk' }).click()
  await expect(
    page.getByText('Om kontot finns har en återställningslänk skickats.'),
  ).toBeVisible()
  await confirmEmail(page, email, 'Reset')
  await expect(page).toHaveURL(/\/account/)
  await page.getByLabel('Nytt lösenord', { exact: true }).fill(newPassword)
  await page
    .getByRole('button', { name: 'Spara lösenord', exact: true })
    .click()
  await expect(page.getByText('Ändringarna har sparats.')).toBeVisible()
  await page.goto('/onboarding')
  await page.getByLabel('Butikens namn').fill('E2E Security')
  await page.getByLabel('Butikens identifierare').fill(`security-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByRole('heading', { name: 'Välkommen.' })).toBeVisible()
  await page.goto('/account')
  const factorResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/auth/v1/factors') && r.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Aktivera tvåstegsverifiering' })
    .click()
  const factor = await (await factorResponse).json()
  await page.getByLabel('Sexsiffrig kod').fill(totp(factor.totp.secret))
  await page.getByRole('button', { name: 'Verifiera kod' }).click()
  await expect(
    page.getByText('Tvåstegsverifiering är aktiverad.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click()
  await page.getByLabel('E-postadress', { exact: true }).fill(email)
  await page.getByLabel('Lösenord', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await expect(page).toHaveURL(/\/mfa/)
  const blocked = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { action: 'profile', name: 'Should fail', locale: 'sv' },
  })
  expect(blocked.status()).toBe(403)
  await page.getByLabel('Sexsiffrig kod').fill(totp(factor.totp.secret))
  await page.getByRole('button', { name: 'Verifiera kod' }).click()
  await expect(page.getByRole('heading', { name: 'Välkommen.' })).toBeVisible()
})

test('archived inspection drafts preserve history and require explicit reopening', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `archive-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Archive')
  await page.getByLabel('Butikens identifierare').fill(`archive-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Archive TEST',
    email: '',
    phone: '00000',
  })
  expect(seller.status()).toBe(200)
  const bag = await post({
    action: 'receiveBag',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
    note: 'Synthetic archive test',
    expectedAgreementId: null,
  })
  expect(bag.status()).toBe(200)
  const bagId = (await bag.json()).id,
    draftId = crypto.randomUUID()
  const original = {
    action: 'saveInspection',
    tenantId,
    requestId: crypto.randomUUID(),
    bagId,
    draftId,
    expectedRevision: 0,
    fields: {
      description: 'TEST archive jacket',
      category: '',
      condition: 'Original description',
    },
  }
  expect((await post(original)).status()).toBe(200)
  const path = `/intake/bags/${bagId}/inspect?draft=${draftId}`
  await page.goto(path)
  const stale = await page.context().newPage()
  await stale.goto(path)
  await stale
    .getByLabel('Beskrivning av varan')
    .fill('Unsaved stale description')
  await page
    .getByRole('button', { name: 'Arkivera utkast', exact: true })
    .click()
  await page
    .getByLabel('Anledning', { exact: true })
    .fill('TEST duplicate draft')
  await page.getByLabel('Jag bekräftar ändringen av utkastets status.').check()
  let archiveCommand: Record<string, unknown> | undefined
  await page.route(
    '**/api/intake',
    async (route) => {
      archiveCommand = route.request().postDataJSON()
      await route.continue()
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Bekräfta ändringen' }).click()
  await expect(page.getByText('Statusändringen är registrerad.')).toBeVisible()
  await expect(page.getByLabel('Beskrivning av varan')).toHaveCount(0)
  await expect(page.locator('.inspection-item')).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Arkiverade utkast', exact: true })
    .click()
  await expect(page.locator('.inspection-item')).toHaveCount(1)
  await stale.getByRole('button', { name: 'Spara utkast', exact: true }).click()
  await expect(stale.getByRole('alert')).toBeVisible()
  await expect(stale.getByLabel('Beskrivning av varan')).toHaveValue(
    'Unsaved stale description',
  )
  await stale.close()
  await page.goto(path)
  await page
    .getByRole('button', { name: 'Återöppna utkast', exact: true })
    .click()
  await page
    .getByLabel('Anledning', { exact: true })
    .fill('TEST reopen after review')
  await page.getByLabel('Jag bekräftar ändringen av utkastets status.').check()
  await page.getByRole('button', { name: 'Bekräfta ändringen' }).click()
  await expect(page.getByText('Statusändringen är registrerad.')).toBeVisible()
  expect(archiveCommand).toBeDefined()
  expect((await post(archiveCommand!)).status()).toBe(200)
  expect((await post(original)).status()).toBe(200)
  await page.goto(path)
  await expect(page.getByLabel('Beskrivning av varan')).toHaveValue(
    'TEST archive jacket',
  )
  await expect(page.locator('.inspection-item')).toHaveCount(1)
  await expect(page.locator('.inspection-history li')).toHaveCount(3)
  await page.goto(`${path}&version=2`)
  await expect(page.locator('.inspection-historical')).toContainText(
    'Arkiverat',
  )
  await expect(page.locator('.inspection-historical')).toContainText(
    'TEST duplicate draft',
  )
  await expect(page.getByLabel('Beskrivning av varan')).toHaveCount(0)
  await page.goto(`${path}&version=1`)
  await expect(page.locator('.inspection-historical')).toContainText('Aktivt')
  await expect(page.locator('.inspection-historical')).not.toContainText(
    'TEST duplicate draft',
  )
})

test('bag queue finds older receipts and keeps seller filters while paging', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `queue-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Bag queue')
  await page.getByLabel('Butikens identifierare').fill(`queue-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = async (data: object) => {
    const r = await page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
    expect(r.status()).toBe(200)
    return (await r.json()).id as string
  }
  const sellerId = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Queue Alpha',
    email: '',
    phone: '00000',
  })
  const otherId = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Queue Beta',
    email: '',
    phone: '00000',
  })
  const expected: string[] = []
  for (let i = 0; i < 51; i++)
    expected.push(
      await post({
        action: 'receiveBag',
        tenantId,
        requestId: crypto.randomUUID(),
        sellerId,
        note: 'Synthetic queue receipt',
        expectedAgreementId: null,
      }),
    )
  await post({
    action: 'receiveBag',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: otherId,
    note: 'Other seller bag',
    expectedAgreementId: null,
  })
  await page.goto(`/intake?seller=${sellerId}#bag-queue`)
  const queue = page.locator('#bag-queue')
  await expect(queue.locator('.intake-bag')).toHaveCount(20)
  await expect(queue).not.toContainText('Queue Beta')
  const ids = async () =>
    queue
      .locator('.intake-bag a.text-link')
      .evaluateAll((links) =>
        links.map((a) => a.getAttribute('href')!.split('/')[3]),
      )
  const first = await ids()
  await queue.getByRole('link', { name: 'Äldre påsar', exact: true }).click()
  await expect(queue.locator('.intake-bag')).toHaveCount(20)
  await expect(page).toHaveURL(new RegExp(`seller=${sellerId}`))
  await expect(
    queue.locator('.intake-bag a.text-link').first(),
  ).toHaveAttribute('href', '/intake/bags/' + expected[30] + '/inspect')
  const second = await ids()
  await queue.getByRole('link', { name: 'Äldre påsar', exact: true }).click()
  await expect(queue.locator('.intake-bag')).toHaveCount(11)
  const third = await ids()
  expect([...first, ...second, ...third]).toEqual([...expected].reverse())
  const oldestLabel = await queue
    .locator('.intake-bag strong')
    .last()
    .innerText()
  const oldestNumber = oldestLabel.match(/K-(\d+)/)![1]
  await queue.getByRole('link', { name: 'Nyare påsar', exact: true }).click()
  await expect(queue.locator('.intake-bag')).toHaveCount(20)
  await expect(
    queue.locator('.intake-bag a.text-link').first(),
  ).toHaveAttribute('href', '/intake/bags/' + expected[30] + '/inspect')
  expect(await ids()).toEqual(second)
  await queue.getByLabel('Sök på påsnummer').fill(`K-${oldestNumber}`)
  await queue.getByRole('button', { name: 'Hitta påse' }).click()
  await expect(queue.locator('.intake-bag')).toHaveCount(1)
  expect(await ids()).toEqual([expected[0]])
  await expect(page).not.toHaveURL(/older=/)
  await page.goto(`/intake?seller=${otherId}&bag=${oldestNumber}#bag-queue`)
  await expect(queue.locator('.intake-bag')).toHaveCount(0)
  await expect(queue).toContainText('Inga påsar matchar detta urval.')
  await queue.getByRole('link', { name: 'Visa alla säljares påsar' }).click()
  await expect(queue.locator('.intake-bag')).toHaveCount(20)
  await expect(queue).toContainText('Queue Beta')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await queue.screenshot({ path: 'test-results/bag-queue-mobile.png' })
  await page.goto('/intake?older=1&newer=2')
  await expect(
    page.getByRole('heading', { name: 'Sidan kunde inte hittas.' }),
  ).toBeVisible()
  await expect(queue).toHaveCount(0)
})

test('reception sources persist through authenticated API without a bag or GUI', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `reception-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Reception')
  await page.getByLabel('Butikens identifierare').fill(`reception-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Reception TEST',
    email: '',
    phone: '00000',
  })
  expect(seller.status()).toBe(200)
  const created = await post({
    action: 'createReception',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
  })
  expect(created.status()).toBe(200)
  const sessionId = (await created.json()).id,
    path = `/api/reception/${sessionId}`
  const empty = await page.request.get(path)
  expect(empty.status()).toBe(200)
  expect(await empty.json()).toMatchObject({
    status: 'empty',
    persisted: true,
    revision: 0,
  })
  const command = {
    action: 'saveReceptionSources',
    tenantId,
    requestId: crypto.randomUUID(),
    sessionId,
    expectedRevision: 0,
    sources: [
      {
        id: crypto.randomUUID(),
        kind: 'observation',
        reference: 'Synthetic staff observation',
        observation: 'Blue jacket, visible tear',
      },
    ],
  }
  expect((await post(command)).status()).toBe(200)
  expect((await post(command)).status()).toBe(200)
  const saved = await page.request.get(path)
  expect(
    saved
      .headers()
      ['cache-control'].split(',')
      .map((value) => value.trim()),
  ).toContain('no-store')
  expect(await saved.json()).toMatchObject({
    status: 'ready',
    persisted: true,
    session: { sessionId, tenantId, revision: 1, sources: command.sources },
  })
  expect(
    (await post({ ...command, requestId: crypto.randomUUID() })).status(),
  ).toBe(409)
  expect(
    (
      await post({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        sources: [
          {
            ...command.sources[0],
            observation: 'Changed under same source ID',
          },
        ],
      })
    ).status(),
  ).toBe(409)
  expect(
    (
      await post({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        sources: [{ ...command.sources[0], kind: 'photo' }],
      })
    ).status(),
  ).toBe(400)
  await page.goto('/intake')
  await expect(page.locator('.intake-bag')).toHaveCount(0)

  const priceSource = {
    id: crypto.randomUUID(),
    kind: 'price-evidence',
    reference: 'TEST appraisal',
    observation: 'Fictional 250 SEK',
  }
  const revisedSources = [...command.sources, priceSource]
  expect(
    (
      await post({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        sources: revisedSources,
      })
    ).status(),
  ).toBe(200)
  const agreement = await post({
    action: 'publishAgreement',
    tenantId,
    requestId: crypto.randomUUID(),
    expectedCurrentId: null,
    title: 'TEST review terms',
    body: 'Fictional terms only.',
    language: 'en',
    required: false,
  })
  expect(agreement.status()).toBe(200)
  const reviewCommand = {
    action: 'publishReceptionReview',
    tenantId,
    requestId: crypto.randomUUID(),
    sessionId,
    sourceRevision: 2,
    previousReviewId: null,
    agreementId: (await agreement.json()).id,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    suggestions: {
      metadata: {
        description: {
          value: 'Blue jacket, visible tear',
          sourceIds: [command.sources[0].id],
          certainty: 'observed',
        },
      },
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'TEST appraisal',
        sourceIds: [priceSource.id],
      },
      questions: [],
    },
  }
  expect((await post(reviewCommand)).status()).toBe(200)
  expect((await post(reviewCommand)).status()).toBe(200)
  expect(
    (await (await page.request.get(path)).json()).latestReview,
  ).toMatchObject({
    id: reviewCommand.requestId,
    version: 1,
    sourceCurrent: true,
    expired: false,
    suggestions: reviewCommand.suggestions,
    terms: {
      versionId: reviewCommand.agreementId,
      body: 'Fictional terms only.',
    },
  })
  expect(
    (await post({ ...reviewCommand, requestId: crypto.randomUUID() })).status(),
  ).toBe(409)
  expect(
    (
      await post({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 2,
        sources: revisedSources,
      })
    ).status(),
  ).toBe(200)
  expect(
    (await (await page.request.get(path)).json()).latestReview,
  ).toMatchObject({ id: reviewCommand.requestId, sourceCurrent: false })
  expect(
    (
      await post({
        ...reviewCommand,
        requestId: crypto.randomUUID(),
        previousReviewId: reviewCommand.requestId,
      })
    ).status(),
  ).toBe(409)
  const otherStore = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'create',
      requestId: crypto.randomUUID(),
      name: 'Reception Other',
      slug: `rec-other-${run}`,
    },
  })
  expect(otherStore.status()).toBe(200)
  expect((await page.request.get(path)).status()).toBe(404)
  expect(
    (await post({ ...command, requestId: crypto.randomUUID() })).status(),
  ).toBe(409)
  await page.goto('/')
  await page.getByRole('button', { name: 'Logga ut' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get(path)).status()).toBe(401)
})
test('seller reviews exact terms on mobile without becoming a store member', async ({
  page,
  browser,
}) => {
  const run = Date.now().toString(36),
    sellerEmail = `seller-review-${run}@example.test`
  await register(
    page,
    `review-owner-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Review Store')
  await page.getByLabel('Butikens identifierare').fill(`review-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'TEST Seller',
    email: sellerEmail,
    phone: '',
  })
  const session = await post({
    action: 'createReception',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
  })
  const sessionId = (await session.json()).id,
    sourceId = crypto.randomUUID()
  const photoId = crypto.randomUUID()
  const png = await sharp({
    create: { width: 32, height: 48, channels: 3, background: '#24649b' },
  })
    .png()
    .toBuffer()
  const upload = await page.request.post(
    `/api/reception/${sessionId}/photo?photo=${photoId}&tenant=${tenantId}`,
    {
      headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'image/png' },
      data: png,
    },
  )
  expect(upload.status()).toBe(200)
  const photoSource = (await upload.json()).source
  expect(
    (
      await post({
        action: 'saveReceptionSources',
        tenantId,
        requestId: crypto.randomUUID(),
        sessionId,
        expectedRevision: 0,
        sources: [
          photoSource,
          {
            id: sourceId,
            kind: 'price-evidence',
            reference: 'Private TEST internal appraisal',
            observation: 'Fictional blue jacket appraisal: 250 SEK',
          },
        ],
      })
    ).status(),
  ).toBe(200)
  const terms = await post({
    action: 'publishAgreement',
    tenantId,
    requestId: crypto.randomUUID(),
    expectedCurrentId: null,
    title: 'TEST terms',
    body: 'Fictional seller terms. No real transaction.',
    language: 'en',
    required: false,
  })
  const reviewId = crypto.randomUUID()
  const reviewCommand = {
    action: 'publishReceptionReview',
    tenantId,
    requestId: reviewId,
    sessionId,
    sourceRevision: 1,
    previousReviewId: null,
    agreementId: (await terms.json()).id,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    suggestions: {
      metadata: {
        description: {
          value: 'Blue TEST jacket',
          sourceIds: [sourceId],
          certainty: 'observed',
        },
      },
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'TEST appraisal, not live AI.',
        sourceIds: [sourceId],
      },
      questions: [],
    },
  }
  expect((await post(reviewCommand)).status()).toBe(200)
  const access = (
    reviewId: string,
    previousId: string | null,
    enabled = true,
  ) =>
    page.request.post('/api/reception/access', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: {
        tenantId,
        reviewId,
        requestId: crypto.randomUUID(),
        previousId,
        enabled,
      },
    })
  const issued = await access(reviewId, null)
  expect(issued.status()).toBe(200)
  const { path, id: accessId } = await issued.json()
  const photoUrl = `/api/seller${path}/photo/${photoId}`
  expect((await page.request.get(photoUrl)).status()).toBe(404)
  // Store owner is not the intended seller despite holding the link.
  await page.goto(path)
  await expect(
    page.getByText('Underlaget är inte tillgängligt.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('Blue TEST jacket', { exact: true })).toHaveCount(
    0,
  )
  const sellerContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 390, height: 844 },
  })
  const mobile = await sellerContext.newPage()
  expect((await mobile.request.get(photoUrl)).status()).toBe(404)
  await mobile.goto(path)
  await expect(
    mobile.getByRole('link', { name: 'Skapa konto', exact: true }),
  ).toBeVisible()
  await register(
    mobile,
    sellerEmail,
    `K!${randomBytes(16).toString('hex')}`,
    path,
  )
  await expect(mobile).toHaveURL(path)
  await expect(
    mobile.getByText('Blue TEST jacket', { exact: true }),
  ).toBeVisible()
  await expect(
    mobile.getByText('Fictional seller terms. No real transaction.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    mobile.getByText('Private TEST internal appraisal', { exact: true }),
  ).toHaveCount(0)
  await expect(mobile.getByLabel('Aktiv butik')).toHaveCount(0)
  await expect(
    mobile.getByRole('button', { name: 'Godkänn detta underlag' }),
  ).toBeDisabled()
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await mobile.screenshot({
    path: 'private/seller-review-mobile.png',
    fullPage: true,
  })
  const sellerPhoto = mobile.getByAltText('Bild som ingår i detta underlag')
  await expect(sellerPhoto).toBeVisible()
  await expect
    .poll(() =>
      sellerPhoto.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth === 32,
      ),
    )
    .toBe(true)
  const imageResponse = await mobile.request.get(photoUrl)
  expect(imageResponse.status()).toBe(200)
  expect(imageResponse.headers()['cache-control']).toContain('no-store')
  expect(imageResponse.headers()['content-type']).toBe('image/jpeg')
  expect(
    (
      await mobile.request.get(
        `/api/reception/${sessionId}/photo?photo=${photoId}`,
      )
    ).status(),
  ).toBe(404)
  await mobile.getByRole('checkbox').check()
  // A failed included image blocks the UI approval, but not declining.
  await mobile.route(`**${photoUrl}`, (route) => route.abort())
  await mobile.reload()
  await expect(
    mobile.getByText('Bilderna kunde inte laddas.', { exact: false }),
  ).toBeVisible()
  await mobile.getByRole('checkbox').check()
  await expect(
    mobile.getByRole('button', { name: 'Godkänn detta underlag' }),
  ).toBeDisabled()
  await expect(
    mobile.getByRole('button', { name: 'Avvisa underlaget' }),
  ).toBeEnabled()
  await mobile.unroute(`**${photoUrl}`)
  await mobile.reload()
  await mobile.getByRole('checkbox').check()
  await mobile.getByRole('button', { name: 'Godkänn detta underlag' }).click()
  await expect(
    mobile.getByText('Ditt godkännande är sparat för denna version.', {
      exact: false,
    }),
  ).toBeVisible()
  await mobile.reload()
  await expect(
    mobile.getByRole('button', { name: 'Godkänn detta underlag' }),
  ).toHaveCount(0)
  const saved = await page.request.get(`/api/reception/${sessionId}`)
  expect((await saved.json()).latestReview.response.decision).toBe('approve')
  // Staff mobile (S8): custody and acceptance at phone width.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/intake/reception?stage=awaiting_custody')
  await expect(
    page.getByRole('heading', { name: 'Mottagningskö' }),
  ).toBeVisible()
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toContainText('Väntar på mottagande')
  // Seller approval never proves the garment is in the store: custody comes first.
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toContainText('registrera fysiskt mottagande av plagget')
  await page.goto(`/intake/reception/${sessionId}`)
  await expect(page.getByText('Inget mottagande registrerat')).toBeVisible()
  await page
    .getByLabel('Anteckning (valfri, till exempel var plagget hänger)')
    .fill('Hänger på stång 3')
  const custodyForm = page.locator('form', {
    has: page.getByRole('button', { name: 'Registrera mottagande' }),
  })
  await custodyForm.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Registrera mottagande' }).click()
  await expect(page.getByText(/Plagg G-\d+/)).toBeVisible()
  await expect(page.getByText('Hänger på stång 3')).toBeVisible()
  await expect(
    page.getByLabel('Anteckning (valfri, till exempel var plagget hänger)'),
  ).toHaveCount(0)
  await page.goto('/intake/reception?stage=ready_to_accept')
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toContainText('acceptera varan under gällande villkor')
  await page.getByLabel('Visa läge').selectOption('declined')
  await page.getByRole('button', { name: 'Visa läge', exact: true }).click()
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toHaveCount(0)
  await page.getByLabel('Visa läge').selectOption('ready_to_accept')
  await page.getByRole('button', { name: 'Visa läge', exact: true }).click()
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toBeVisible()
  // Delegated pricing: the store accepts the garment under the terms in force.
  await page.goto(`/intake/reception/${sessionId}`)
  const acceptForm = page.locator('form', {
    has: page.getByRole('button', { name: 'Acceptera vara' }),
  })
  await expect(acceptForm.getByLabel('Accepterat pris')).toHaveValue(/\d/)
  await acceptForm.getByRole('checkbox').check()
  await acceptForm.getByRole('button', { name: 'Acceptera vara' }).click()
  await expect(
    page.getByRole('link', { name: 'Öppna varan' }).first(),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Öppna varan' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Vara Inlämnat plagg' }),
  ).toBeVisible()
  await expect(page.getByText('Frysta villkor')).toBeVisible()
  await expect(page.getByText('Ursprung dokumenterat')).toBeVisible()
  await page.goto('/intake/reception?stage=accepted')
  await expect(
    page.locator(`a[href="/intake/reception/${sessionId}"]`),
  ).toContainText('Accepterad som vara')
  expect((await access(reviewId, accessId, false)).status()).toBe(200)
  expect((await mobile.request.get(photoUrl)).status()).toBe(404)
  await mobile.reload()
  await expect(
    mobile.getByText('Underlaget är inte tillgängligt.', { exact: false }),
  ).toBeVisible()
  const secondId = crypto.randomUUID()
  expect(
    (
      await post({
        ...reviewCommand,
        requestId: secondId,
        previousReviewId: reviewId,
      })
    ).status(),
  ).toBe(200)
  const second = await (await access(secondId, null)).json()
  await mobile.goto(second.path)
  await mobile.getByRole('button', { name: 'Avvisa underlaget' }).click()
  await expect(
    mobile.getByText('Du har avvisat denna version.', { exact: false }),
  ).toBeVisible()
  await page.goto(`/intake/reception/${sessionId}`)
  await page
    .getByRole('link', { name: 'Versionshistorik', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Versionshistorik', exact: true }),
  ).toBeVisible()
  const firstHistory = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'version 1', exact: true }),
  })
  const secondHistory = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'version 2', exact: true }),
  })
  await expect(firstHistory).toContainText('Säljaren godkände denna version.')
  await expect(secondHistory).toContainText('Säljaren avvisade denna version.')
  await page.goto(`/intake/reception/${sessionId}/history?beforeReview=2`)
  await expect(firstHistory).toBeVisible()
  await expect(secondHistory).toHaveCount(0)
  // Neither response gave staff write capability.
  expect(
    (
      await mobile.request.post('/api/reception/access', {
        headers: { Origin: 'http://127.0.0.1:3000' },
        data: {
          tenantId,
          reviewId: secondId,
          requestId: crypto.randomUUID(),
          previousId: second.id,
          enabled: false,
        },
      })
    ).status(),
  ).toBe(409)
  await sellerContext.close()
})
test('operator reception guides saved evidence, exact review and link replacement', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `operator-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Operator')
  await page.getByLabel('Butikens identifierare').fill(`operator-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  expect(
    (
      await post({
        action: 'registerSeller',
        tenantId,
        requestId: crypto.randomUUID(),
        name: 'Operator TEST Seller',
        email: `operator-seller-${run}@example.test`,
        phone: '',
      })
    ).status(),
  ).toBe(200)
  expect(
    (
      await post({
        action: 'publishAgreement',
        tenantId,
        requestId: crypto.randomUUID(),
        expectedCurrentId: null,
        title: 'Operator TEST terms',
        body: 'Fictional reviewed terms for browser test only.',
        language: 'en',
        required: false,
      })
    ).status(),
  ).toBe(200)
  await page.goto('/intake')
  await page
    .getByRole('link', { name: 'Mottagning av plagg', exact: true })
    .click()
  await page.getByLabel('Sök säljare på namn').fill('Operator TEST')
  await page.getByRole('button', { name: 'Sök', exact: true }).click()
  await expect(page.getByLabel('Välj registrerad säljare')).toContainText(
    'Operator TEST Seller',
  )
  await page
    .getByRole('button', { name: 'Starta mottagning', exact: true })
    .click()
  await expect(page).toHaveURL(/\/intake\/reception\/[a-f0-9-]+$/)
  const receptionPath = new URL(page.url()).pathname,
    sessionId = receptionPath.split('/').pop()
  const stale = await page.context().newPage()
  await stale.goto(receptionPath)
  await page.getByLabel('Beskriv plagget').fill('Blue operator TEST jacket')
  await page
    .getByLabel('Föreslaget försäljningspris', { exact: true })
    .fill('250,50')
  await page.getByLabel('Prisunderlagets källa').fill('TEST staff appraisal')
  await page
    .getByLabel('Motivera prisförslaget')
    .fill('Fictional condition assessment, no live AI.')
  // Lose a successful response once. A retry must retain the exact request/source IDs.
  let dropped = false
  await page.route('**/api/intake', async (route) => {
    const data = route.request().postDataJSON()
    if (data.action === 'saveReceptionSources' && !dropped) {
      dropped = true
      await route.fetch()
      await route.abort()
      return
    }
    await route.continue()
  })
  await page
    .getByRole('button', { name: 'Spara beskrivning och prisunderlag' })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Svaret kunde inte bekräftas' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Försök igen', exact: true }).click()
  await expect(
    page.getByText('Sparad källversion 1', { exact: true }),
  ).toBeVisible()
  await page.unroute('**/api/intake')
  await expect(
    page.getByRole('button', { name: 'Publicera granskat underlag' }),
  ).toBeDisabled()
  await page.locator('input[name="review-final"]').check()
  await page
    .getByRole('button', { name: 'Publicera granskat underlag' })
    .click()
  await expect(
    page.getByRole('heading', { name: '3. Säljarens beslut — version 1' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Skapa personlig länk' }).click()
  await expect(page.getByLabel('Länk till säljarens granskning')).toHaveValue(
    /\/review\/[a-f0-9]{64}$/,
  )
  const firstLink = await page
    .getByLabel('Länk till säljarens granskning')
    .inputValue()
  await page.getByRole('button', { name: 'Ersätt tidigare länk' }).click()
  await expect(
    page.getByLabel('Länk till säljarens granskning'),
  ).not.toHaveValue(firstLink)
  await page.getByRole('button', { name: 'Återkalla länken' }).click()
  await expect(page.getByLabel('Länk till säljarens granskning')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Beskriv plagget')).toHaveValue(
    'Blue operator TEST jacket',
  )
  const current = await (
    await page.request.get(`/api/reception/${sessionId}`)
  ).json()
  expect(current.session.revision).toBe(1)
  expect(current.latestReview.access.enabled).toBe(false)
  await stale.getByLabel('Beskriv plagget').fill('Stale edit')
  await stale
    .getByLabel('Föreslaget försäljningspris', { exact: true })
    .fill('300')
  await stale.getByLabel('Prisunderlagets källa').fill('TEST')
  await stale.getByLabel('Motivera prisförslaget').fill('TEST')
  await stale
    .getByRole('button', { name: 'Spara beskrivning och prisunderlag' })
    .click()
  await expect(
    stale.getByRole('button', { name: 'Ladda om sparat läge' }),
  ).toBeVisible()
  await stale.close()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'private/operator-reception-mobile.png',
    fullPage: true,
  })
  await page.getByRole('link', { name: 'Till mottagningarna' }).click()
  await expect(
    page.getByRole('link', { name: /Operator TEST Seller/ }),
  ).toBeVisible()
  // Fixture proposals use the real SQL entry point under the operator identity.
  // No direct insert bypasses the proposal's validation or authorization.
  const { Client } = createRequire(import.meta.url)('pg')
  const fixture = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await fixture.connect()
  const operationId = crypto.randomUUID(),
    rejectedId = crypto.randomUUID()
  try {
    const actor = await fixture.query(
      'select id from auth.users where email=$1',
      [`operator-${run}@example.test`],
    )
    const latest = await fixture.query(
      'select session_id,source_revision,id,agreement_id,suggestions from reception_reviews where tenant_id=$1 order by version desc limit 1',
      [tenantId],
    )
    const review = latest.rows[0]
    await fixture.query('begin')
    await fixture.query('set local role authenticated')
    await fixture.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor.rows[0].id, role: 'authenticated' }),
    ])
    for (const [id, description] of [
      [operationId, 'Agent proposal to approve'],
      [rejectedId, 'Agent proposal to reject'],
    ]) {
      const suggestions = structuredClone(review.suggestions)
      suggestions.metadata.description.value = description
      await fixture.query(
        "select propose_operation($1,$2,'publishReceptionReview',$3::jsonb,'browser-fixture',now()+interval '1 hour')",
        [
          tenantId,
          id,
          JSON.stringify({
            sessionId: review.session_id,
            sourceRevision: review.source_revision,
            previousReviewId: review.id,
            agreementId: review.agreement_id,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            suggestions,
          }),
        ],
      )
    }
    await fixture.query('commit')
  } finally {
    await fixture.end()
  }
  await page.goto('/intake/operations')
  const approved = page
    .locator('li.card')
    .filter({ hasText: 'Agent proposal to approve' })
  await approved.getByRole('link', { name: 'Granska förslaget' }).click()
  await expect(
    approved.getByText('Fictional reviewed terms for browser test only.', {
      exact: true,
    }),
  ).toBeVisible()
  const comparison = approved.getByRole('region', {
    name: '\u00c4ndringar sedan tidigare publicering',
  })
  await expect(comparison).toBeVisible()
  await expect(
    comparison.getByText('Efter: Agent proposal to approve', { exact: true }),
  ).toBeVisible()
  await expect(comparison.getByText(/F\u00f6re:/)).toBeVisible()
  await expect(approved.getByRole('checkbox')).toHaveCount(3)
  await approved.locator('input[name="checked"]').check()
  await approved
    .getByRole('button', { name: 'Godkänn och publicera', exact: true })
    .click()
  await expect(approved.locator('.badge')).toHaveText('Väntar på beslut')
  await approved.locator('input[name="field-description"]').check()
  await approved.locator('input[name="field-price"]').check()
  await expect(approved.locator('input[name="checked"]')).not.toBeChecked()
  await approved.locator('input[name="checked"]').check()
  await approved
    .getByRole('button', { name: 'Godkänn och publicera', exact: true })
    .click()
  await expect(approved.locator('.badge')).toHaveText('Godkänt och utfört')
  await page.goto('/intake/operations')
  const rejected = page
    .locator('li.card')
    .filter({ hasText: 'Agent proposal to reject' })
  await rejected.getByRole('link', { name: 'Granska förslaget' }).click()
  await expect(
    page.getByRole('region', { name: 'Källor och exakta avtalsvillkor' }),
  ).toBeVisible()
  await expect(
    rejected.getByRole('button', {
      name: 'Godkänn och publicera',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(rejected.getByRole('alert')).toContainText('har ändrats')
  await rejected.getByRole('button', { name: 'Avvisa', exact: true }).click()
  await expect(rejected.locator('.badge')).toHaveText('Avvisat')
  await page.goto('/intake/operations')
  const verify = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await verify.connect()
  try {
    const outcomes = await verify.query(
      'select operation_id,outcome from operation_decisions where operation_id=any($1::uuid[])',
      [[operationId, rejectedId]],
    )
    expect(outcomes.rows).toEqual(
      expect.arrayContaining([
        { operation_id: operationId, outcome: 'executed' },
        { operation_id: rejectedId, outcome: 'rejected' },
      ]),
    )
    const reviews = await verify.query(
      'select id from reception_reviews where id=any($1::uuid[])',
      [[operationId, rejectedId]],
    )
    expect(reviews.rows).toEqual([{ id: operationId }])
  } finally {
    await verify.end()
  }
})
test('AI HTTP fixture stages a sourced proposal before explicit staff publication', async ({
  page,
}) => {
  test.skip(
    process.env.KOMISIO_TEST_AI_HTTP_FIXTURE !== 'enabled',
    'Dedicated local fixture runner only; no live provider',
  )
  const tenantId = process.env.KOMISIO_RECEPTION_AI_TENANTS!,
    run = Date.now().toString(36),
    email = `ai-fixture-${run}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  await expect(page).toHaveURL(/\/onboarding/)
  // Test fixture only, fixed LOCAL database; no hosted administrative credential.
  const { Client } = createRequire(import.meta.url)('pg')
  const fixture = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await fixture.connect()
  try {
    const user = await fixture.query(
      'select id from auth.users where email=$1',
      [email],
    )
    await fixture.query(
      'insert into tenants(id,name,slug,created_by) values($1,$2,$3,$4)',
      [tenantId, 'HTTP fixture store', `ai-${run}`, user.rows[0].id],
    )
  } finally {
    await fixture.end()
  }
  expect(
    (
      await page.request.post('/api/platform', {
        headers: { Origin: 'http://127.0.0.1:3000' },
        data: { action: 'select', tenantId },
      })
    ).status(),
  ).toBe(200)
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: { ...data, tenantId, requestId: crypto.randomUUID() },
    })
  const seller = await post({
    action: 'registerSeller',
    name: 'AI HTTP fixture seller',
    email: 'fixture-seller@example.test',
    phone: '',
  })
  expect(seller.status()).toBe(200)
  const receipt = await post({
      action: 'createReception',
      sellerId: (await seller.json()).id,
    }),
    sessionId = (await receipt.json()).id
  expect(
    (
      await post({
        action: 'publishAgreement',
        expectedCurrentId: null,
        title: 'HTTP fixture terms',
        body: 'TEST ONLY – no real agreement.',
        language: 'en',
        required: false,
      })
    ).status(),
  ).toBe(200)
  await page.goto(`/intake/reception/${sessionId}`)
  await page.getByLabel('Beskriv plagget').fill('Synthetic blue jacket')
  await page
    .getByLabel('Föreslaget försäljningspris', { exact: true })
    .fill('250')
  await page.getByLabel('Prisunderlagets källa').fill('Fixture store appraisal')
  await page
    .getByLabel('Motivera prisförslaget')
    .fill('Fictional test price, no market data')
  await page
    .getByRole('button', { name: 'Spara beskrivning och prisunderlag' })
    .click()
  await expect(
    page.getByText('Sparad källversion 1', { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('button', { name: 'Analysera underlaget med AI' })
    .click()
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'AI-förslag', exact: true }),
  })
  await expect(
    panel.getByText('HTTP FIXTURE – blue jacket, not live AI', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByText('AI-förslag, behöver kontrolleras', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByText('TEST ONLY – no real agreement.', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: 'Publicera granskat underlag' }),
  ).toBeDisabled()
  const before = await (
    await page.request.get(`/api/reception/${sessionId}`)
  ).json()
  expect(before.latestReview).toBeNull()
  await expect(panel.getByRole('checkbox')).toHaveCount(3)
  const final = panel.locator('input[name="review-final"]')
  await final.check()
  await expect(
    panel.getByRole('button', { name: 'Publicera granskat underlag' }),
  ).toBeDisabled()
  await panel.locator('input[name="review-description"]').check()
  await expect(final).not.toBeChecked()
  await final.check()
  await expect(
    panel.getByRole('button', { name: 'Publicera granskat underlag' }),
  ).toBeDisabled()
  await panel.locator('input[name="review-price"]').check()
  await expect(final).not.toBeChecked()
  await final.check()
  let publishedRequest: Record<string, unknown> | undefined
  await page.route('**/api/intake', async (route) => {
    const body = route.request().postDataJSON()
    if (body.action !== 'publishReceptionReview') {
      await route.continue()
      return
    }
    if (!publishedRequest) {
      publishedRequest = body
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    } else {
      expect(body).toEqual(publishedRequest)
      await route.continue()
    }
  })
  await panel
    .getByRole('button', { name: 'Publicera granskat underlag' })
    .click()
  await expect(panel.getByRole('alert')).toBeVisible()
  for (const checkbox of await panel.getByRole('checkbox').all())
    await expect(checkbox).toBeDisabled()
  await panel.getByRole('button', { name: 'Försök igen', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: /Säljarens beslut/ }),
  ).toBeVisible()
  const after = await (
    await page.request.get(`/api/reception/${sessionId}`)
  ).json()
  expect(after.latestReview.suggestions.metadata.description.certainty).toBe(
    'observed',
  )
  expect(after.latestReview.suggestions.metadata.description.value).toContain(
    'HTTP FIXTURE',
  )
  expect(after.latestReview.id).toBe(publishedRequest!.requestId)
  expect(after.latestReview.version).toBe(1)
  expect(after.latestReview.response).toBeNull()
  expect(after.latestReview.access).toBeNull()
  const limited = await page.request.post('/api/reception/assistance', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { tenantId, sessionId, revision: 1, requestId: crypto.randomUUID() },
  })
  expect(limited.status()).toBe(429)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('private reception photo uploads attach immutably and require staff access', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `photo-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Photos')
  await page.getByLabel('Butikens identifierare').fill(`photo-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Photo TEST',
    email: '',
    phone: '0000',
  })
  const reception = await post({
    action: 'createReception',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
  })
  const sessionId = (await reception.json()).id
  const png = await sharp({
    create: { width: 32, height: 48, channels: 3, background: '#24649b' },
  })
    .png()
    .toBuffer()
  await page.goto(`/intake/reception/${sessionId}`)
  await page.getByLabel('Välj eller ta en bild').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await page
    .getByRole('button', { name: 'Spara bild till mottagningen' })
    .click()
  await expect(
    page.getByText('Sparad källversion 1', { exact: true }),
  ).toBeVisible()
  const image = page.getByAltText('Privat bild från mottagningen')
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true)
  const state = await (
      await page.request.get(`/api/reception/${sessionId}`)
    ).json(),
    source = state.session.sources[0]
  const endpoint = `/api/reception/${sessionId}/photo?photo=${source.id}`
  const unavailable = await page.request.post('/api/reception/assistance', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { tenantId, sessionId, revision: 1, requestId: crypto.randomUUID() },
  })
  expect(unavailable.status()).toBe(200)
  expect(await unavailable.json()).toEqual({
    status: 'unavailable',
    proposal: null,
  })
  await expect(
    page.getByText('AI är inte aktiverat för denna butik.', { exact: false }),
  ).toBeVisible()
  expect(
    (
      await page.request.post('/api/reception/assistance', {
        headers: { Origin: 'https://unrelated.example.test' },
        data: {
          tenantId,
          sessionId,
          revision: 1,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403)
  const imageResponse = await page.request.get(endpoint)
  expect(imageResponse.status()).toBe(200)
  expect(imageResponse.headers()['cache-control']).toContain('no-store')
  expect(await imageResponse.body()).toEqual(png)
  const retry = () =>
    page.request.post(`${endpoint}&tenant=${tenantId}`, {
      headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'image/png' },
      data: png,
    })
  expect((await retry()).status()).toBe(200)
  const changed = Buffer.from(png)
  changed[changed.length - 1] ^= 1
  expect(
    (
      await page.request.post(`${endpoint}&tenant=${tenantId}`, {
        headers: { Origin: 'http://127.0.0.1:3000' },
        data: changed,
      })
    ).status(),
  ).toBe(400)
  expect(
    (
      await page.request.post(
        `/api/reception/${sessionId}/photo?photo=${crypto.randomUUID()}&tenant=${tenantId}`,
        {
          headers: {
            Origin: 'http://127.0.0.1:3000',
            'Content-Type': 'image/png',
          },
          data: '<svg>not PNG</svg>',
        },
      )
    ).status(),
  ).toBe(400)
  const publicResponse = await page.request.get(
    `http://127.0.0.1:54321/storage/v1/object/public/reception-photos/${source.reference}`,
  )
  expect(publicResponse.ok()).toBe(false)
  const unrelated = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'create',
      name: 'Photo other store',
      slug: `photo-other-${run}`,
      requestId: crypto.randomUUID(),
    },
  })
  expect(unrelated.status()).toBe(200)
  expect((await page.request.get(endpoint)).status()).toBe(404)
  await page
    .getByRole('button', { name: 'Logga ut', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get(endpoint)).status()).toBe(401)
})

test('staged inspection edits require field review and preserve stale drafts', async ({
  page,
}) => {
  const run = Date.now().toString(36),
    email = `staged-inspection-${run}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  await page.getByLabel('Butikens namn').fill('E2E Staged Inspection')
  await page
    .getByLabel('Butikens identifierare')
    .fill(`staged-inspection-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = (data: object) =>
    page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
  const seller = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Staged TEST',
    email: '',
    phone: '00000',
  })
  expect(seller.status()).toBe(200)
  const receipt = await post({
    action: 'receiveBag',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId: (await seller.json()).id,
    note: '',
    expectedAgreementId: null,
  })
  expect(receipt.status()).toBe(200)
  const bagId = (await receipt.json()).id,
    draftId = crypto.randomUUID()
  const saved = await post({
    action: 'saveInspection',
    tenantId,
    requestId: crypto.randomUUID(),
    bagId,
    draftId,
    expectedRevision: 0,
    fields: {
      description: 'Original TEST coat',
      category: 'Clothes',
      condition: 'Good',
    },
  })
  expect(saved.status()).toBe(200)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  const operationId = crypto.randomUUID(),
    rejectedId = crypto.randomUUID()
  try {
    const actor = (
      await db.query('select id from auth.users where email=$1', [email])
    ).rows[0].id
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
    for (const id of [operationId, rejectedId]) {
      await db.query(
        "select propose_operation($1,$2,'saveInspectionDraft',$3::jsonb,'browser-fixture',now()+interval '1 hour')",
        [
          tenantId,
          id,
          JSON.stringify({
            bagId,
            draftId,
            expectedRevision: 1,
            fields: {
              description: 'Proposed TEST coat',
              category: '',
              condition: 'Good',
            },
          }),
        ],
      )
    }
    await db.query('commit')
    await page.goto(`/intake/operations/${operationId}`)
    await expect(
      page.getByText('Före: Original TEST coat', { exact: true }),
    ).toBeVisible()
    const form = page.locator('form.intake-fields')
    await expect(form.getByRole('checkbox')).toHaveCount(3)
    const approve = form.getByRole('button', {
      name: 'Godkänn och spara utkast',
      exact: true,
    })
    await approve.click()
    expect(
      (
        await db.query(
          'select count(*)::int n from operation_decisions where operation_id=$1',
          [operationId],
        )
      ).rows[0].n,
    ).toBe(0)
    await form.locator('input[name="checked"]').check()
    await form.locator('input[name="field-description"]').check()
    await approve.click()
    expect(
      (
        await db.query(
          'select count(*)::int n from operation_decisions where operation_id=$1',
          [operationId],
        )
      ).rows[0].n,
    ).toBe(0)
    await form.locator('input[name="field-category"]').check()
    await expect(form.locator('input[name="checked"]')).not.toBeChecked()
    await form.locator('input[name="checked"]').check()
    await form.getByRole('textbox').fill('Reviewed fixture fields')
    const attempts = new Map<string, Record<string, unknown>[]>()
    await page.route('**/api/operations', async (route) => {
      const body = route.request().postDataJSON(),
        prior = attempts.get(body.operationId) ?? []
      prior.push(body)
      attempts.set(body.operationId, prior)
      if (prior.length === 1) {
        // Approval commits before the response is lost; rejection never reaches the server.
        if (body.operationId === operationId)
          expect((await route.fetch()).status()).toBe(200)
        await route.abort('failed')
      } else {
        expect(body).toEqual(prior[0])
        await route.continue()
      }
    })
    await approve.click()
    await expect(form.getByRole('alert')).toBeVisible()
    await expect(form.getByRole('textbox')).toBeDisabled()
    for (const checkbox of await form.getByRole('checkbox').all())
      await expect(checkbox).toBeDisabled()
    await expect(
      form.getByRole('button', { name: 'Avvisa', exact: true }),
    ).toHaveCount(0)
    await form
      .getByRole('button', {
        name: 'Försök igen med samma beslut',
        exact: true,
      })
      .click()
    await expect(page.locator('li.card .badge')).toHaveText(
      'Godkänt och utfört',
    )
    const rows = (
      await db.query(
        'select id,revision,description,category,created_by from inspection_draft_revisions where draft_id=$1 order by revision',
        [draftId],
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      id: operationId,
      revision: 2,
      description: 'Proposed TEST coat',
      category: '',
      created_by: actor,
    })
    await page.goto(`/intake/operations/${rejectedId}`)
    await expect(
      page.getByRole('button', {
        name: 'Godkänn och spara utkast',
        exact: true,
      }),
    ).toBeDisabled()
    await expect(page.locator('li.card').getByRole('alert')).toContainText(
      'har ändrats',
    )
    // Rejecting never requires approving any field, including a stale proposal.
    await page
      .locator('form.intake-fields')
      .getByRole('textbox')
      .fill('Reject stale fixture')
    await page.getByRole('button', { name: 'Avvisa', exact: true }).click()
    await expect(
      page.locator('form.intake-fields').getByRole('alert'),
    ).toBeVisible()
    await expect(
      page.locator('form.intake-fields').getByRole('textbox'),
    ).toBeDisabled()
    expect(
      (
        await db.query(
          'select count(*)::int n from operation_decisions where operation_id=$1',
          [rejectedId],
        )
      ).rows[0].n,
    ).toBe(0)
    await page
      .getByRole('button', {
        name: 'Försök igen med samma beslut',
        exact: true,
      })
      .click()
    await expect(page.locator('li.card .badge')).toHaveText('Avvisat')
    expect(attempts.get(operationId)).toHaveLength(2)
    expect(attempts.get(rejectedId)).toHaveLength(2)
    const decisions = (
      await db.query(
        'select operation_id,reason from operation_decisions where operation_id=any($1::uuid[])',
        [[operationId, rejectedId]],
      )
    ).rows
    expect(decisions).toEqual(
      expect.arrayContaining([
        { operation_id: operationId, reason: 'Reviewed fixture fields' },
        { operation_id: rejectedId, reason: 'Reject stale fixture' },
      ]),
    )
    expect(decisions).toHaveLength(2)
    expect(
      (
        await db.query(
          'select count(*)::int n from inspection_draft_revisions where draft_id=$1',
          [draftId],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await db.end()
  }
})

test('operation queue pages reach older proposals and retain status filters', async ({
  page,
}) => {
  const run = Date.now().toString(36),
    email = `queue-pages-${run}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  await page.getByLabel('Butikens namn').fill('E2E Queue pages')
  await page.getByLabel('Butikens identifierare').fill(`queue-pages-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  try {
    const actor = (
      await db.query('select id from auth.users where email=$1', [email])
    ).rows[0].id
    // Read-only history fixtures: tied microsecond timestamps; not command preflight evidence.
    await db.query(
      `insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at,created_at)
      select gen_random_uuid(),$1,'saveInspectionDraft','low',
      jsonb_build_object('bagId',gen_random_uuid(),'draftId',gen_random_uuid(),'expectedRevision',1,'fields',jsonb_build_object('description','Paging fixture '||g,'category','','condition','')),
      'agent','paging-fixture',$2,case when g=1 then now()-interval '1 hour' else now()+interval '1 day' end,
      '2026-09-01 12:00:00.123456+00'::timestamptz+(g/5)*interval '1 microsecond'
      from generate_series(1,55) g`,
      [tenantId, actor],
    )
    await page.goto('/intake/operations')
    const rows = page.getByRole('link', {
      name: 'Granska f\u00f6rslaget',
      exact: true,
    })
    async function older() {
      const previous = await rows.first().getAttribute('href')
      const link = page.getByRole('link', {
        name: 'Visa \u00e4ldre f\u00f6rslag',
      })
      const destination = await link.getAttribute('href')
      await link.click()
      await expect(page).toHaveURL(`http://127.0.0.1:3000${destination}`)
      await expect(rows.first()).not.toHaveAttribute('href', previous!)
    }
    const seen: string[] = []
    for (const count of [20, 20, 15]) {
      await expect(rows).toHaveCount(count)
      seen.push(
        ...(await rows.evaluateAll((links) =>
          links.map((link) => link.getAttribute('href')!),
        )),
      )
      if (count === 20) await older()
    }
    expect(new Set(seen).size).toBe(55)
    await expect(
      page.getByRole('link', { name: 'Visa \u00e4ldre f\u00f6rslag' }),
    ).toHaveCount(0)
    const filters = page.getByRole('navigation', {
      name: 'Filtrera \u00e5tg\u00e4rder',
    })
    await filters.locator('a[href$="status=open"]').click()
    await expect(rows).toHaveCount(20)
    expect(new URL(page.url()).searchParams.has('beforeId')).toBe(false)
    await older()
    await expect(rows).toHaveCount(20)
    expect(new URL(page.url()).searchParams.get('status')).toBe('open')
    expect(new URL(page.url()).searchParams.get('beforeCreated')).toMatch(
      /\.\d{6}/,
    )
    await older()
    await expect(rows).toHaveCount(14)
    await page.getByRole('link', { name: 'Till f\u00f6rsta sidan' }).click()
    await expect(rows).toHaveCount(20)
    expect(new URL(page.url()).searchParams.get('status')).toBe('open')
    expect(new URL(page.url()).searchParams.has('beforeId')).toBe(false)
    await filters.locator('a[href$="status=expired"]').click()
    await expect(rows).toHaveCount(1)
    await page.setViewportSize({ width: 375, height: 812 })
    expect(
      await filters.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await filters.locator('a[href$="status=rejected"]').click()
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText('Inga f\u00f6rslag matchar den h\u00e4r vyn.'),
    ).toBeVisible()
    await page.goto(`/intake/operations?beforeId=${crypto.randomUUID()}`)
    // Streamed Next.js notFound renders a denial page with HTTP 200.
    await expect(
      page.getByRole('heading', { name: 'Sidan kunde inte hittas.' }),
    ).toBeVisible()
    await expect(rows).toHaveCount(0)
    expect(
      (
        await db.query(
          'select count(*)::int n from operation_decisions where tenant_id=$1',
          [tenantId],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await db.end()
  }
})

test('store policy publishes safely and supports agreement-free staff review', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  await register(
    page,
    `policy-${run}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('E2E Policy')
  await page.getByLabel('Butikens identifierare').fill(`policy-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'Butikspolicy' })
  await expect(section.getByLabel('Butikens provision (%)')).toHaveValue('60')
  const stale = await page.context().newPage()
  await stale.goto('/settings')
  await section.getByLabel('Butikens provision (%)').fill('55.25')
  await section.getByLabel('Publicering av underlag', { exact: true }).uncheck()
  await section
    .getByLabel('Jag har granskat villkoren', { exact: false })
    .check()
  let envelope: unknown
  await page.route(
    '**/api/intake',
    async (route) => {
      envelope = route.request().postDataJSON()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    },
    { times: 1 },
  )
  await section.getByRole('button', { name: 'Publicera policy' }).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.getByLabel('Butikens provision (%)')).toBeDisabled()
  await page.route(
    '**/api/intake',
    async (route) => {
      expect(route.request().postDataJSON()).toEqual(envelope)
      await route.continue()
    },
    { times: 1 },
  )
  await section
    .getByRole('button', { name: 'Försök igen', exact: true })
    .click()
  await expect(
    section.getByText('Publicerad version 1', { exact: true }),
  ).toBeVisible()
  await expect(section.getByLabel('Butikens provision (%)')).toHaveValue(
    '55.25',
  )
  await stale.getByLabel('Jag har granskat villkoren', { exact: false }).check()
  await stale.getByRole('button', { name: 'Publicera policy' }).click()
  await expect(
    stale.getByRole('region', { name: 'Butikspolicy' }).getByRole('alert'),
  ).toBeVisible()
  await stale.close()
  const post = async (data: object) => {
    const response = await page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data,
    })
    expect(response.status()).toBe(200)
    return (await response.json()).id as string
  }
  const sellerId = await post({
    action: 'registerSeller',
    tenantId,
    requestId: crypto.randomUUID(),
    name: 'Policy seller',
    email: 'policy-seller@example.test',
    phone: '',
  })
  const sessionId = await post({
    action: 'createReception',
    tenantId,
    requestId: crypto.randomUUID(),
    sellerId,
  })
  await page.goto(`/intake/reception/${sessionId}`)
  await page.getByLabel('Beskriv plagget').fill('Synthetic policy jacket')
  await page
    .getByLabel('Föreslaget försäljningspris', { exact: true })
    .fill('100')
  await page.getByLabel('Prisunderlagets källa').fill('Synthetic appraisal')
  await page.getByLabel('Motivera prisförslaget').fill('Only a test')
  await page
    .getByRole('button', { name: 'Spara beskrivning och prisunderlag' })
    .click()
  await expect(
    page.getByText('Sparad källversion 1', { exact: true }),
  ).toBeVisible()
  await page.locator('input[name="review-final"]').check()
  await page
    .getByRole('button', { name: 'Publicera granskat underlag' })
    .click()
  await expect(
    page.getByRole('heading', { name: '3. Säljarens beslut — version 1' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Skapa personlig länk' }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByText('Synthetic policy jacket', { exact: true }).first(),
  ).toBeVisible()
})
