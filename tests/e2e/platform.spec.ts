import { test, expect, type Page } from '@playwright/test'
import { randomBytes, createHmac } from 'node:crypto'

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
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(
    page.getByText('You followed a store invitation.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', `/login?next=${encodeURIComponent(invitationPath)}`)
})

test('anonymous invitation uses the selected language', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'English', exact: true }).click()
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
  await page.getByRole('button', { name: 'English', exact: true }).click()
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

async function confirmEmail(page: Page, email: string, subjectPart = '') {
  let link = ''
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          'http://127.0.0.1:54324/api/v1/messages',
        )
        if (!response.ok()) return false
        const inbox = await response.json()
        const message = inbox.messages?.find(
          (m: { To: { Address: string }[]; Subject: string }) =>
            m.To.some((t) => t.Address === email) &&
            m.Subject.includes(subjectPart),
        )
        if (!message) return false
        const detail = await (
          await page.request.get(
            `http://127.0.0.1:54324/api/v1/message/${message.ID}`,
          )
        ).json()
        const html = detail.HTML ?? detail.html ?? ''
        link = (
          html.match(/href="(http[^\"]*\/auth\/v1\/verify[^\"]*)"/)?.[1] ?? ''
        ).replaceAll('&amp;', '&')
        return !!link
      },
      { timeout: 25000 },
    )
    .toBe(true)
  await page.goto(link)
}
async function register(
  page: Page,
  email: string,
  password: string,
  next?: string,
) {
  await page.goto(
    '/register' + (next ? `?next=${encodeURIComponent(next)}` : ''),
  )
  await page.getByLabel('E-postadress', { exact: true }).fill(email)
  await page.getByLabel('Lösenord', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Skapa konto', exact: true }).click()
  await expect(
    page.getByText('Kontrollera din e-post och följ länken'),
  ).toBeVisible()
  await confirmEmail(page, email)
}
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
