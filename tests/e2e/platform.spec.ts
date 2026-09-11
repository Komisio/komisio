import { test, expect, type Page } from '@playwright/test'
import { randomBytes, createHmac } from 'node:crypto'

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
  await page.getByLabel('Butikens identifierare').fill(`garden-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
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
  const invite = await page
    .getByRole('textbox', { name: 'Inbjudningslänken är klar' })
    .inputValue()
  await expect(
    page.getByText(
      'Dela länken med mottagaren. Automatisk e-post är inte aktiverad.',
    ),
  ).toBeVisible()
  const staffContext = await browser.newContext()
  const staff = await staffContext.newPage()
  await register(staff, staffEmail, password, new URL(invite).pathname)
  await expect(
    staff.getByRole('button', { name: 'Acceptera inbjudan', exact: true }),
  ).toBeVisible()
  await staff
    .getByRole('button', { name: 'Acceptera inbjudan', exact: true })
    .click()
  await expect(staff.getByRole('heading', { name: 'Välkommen.' })).toBeVisible()
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
