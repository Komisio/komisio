import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The ZPL template editor when a save or reset reply is lost or damaged.
// Publishing is not replay-safe (every call writes a new version), so the
// editor must freeze and offer a reload rather than resend. Only the local
// synthetic store; no preview render, print job, worker or provider.

const VALID = '^XA^FO10,10^FD{reference}^FS^XZ'

async function openEditor(
  page: Page,
  email: string,
  seed: { custom: boolean } = { custom: false },
) {
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  if (seed.custom)
    await f.db.query(
      "select set_label_template($1,'item','Synthetic template',$2)",
      [f.tenant, VALID],
    )
  await f.commit()
  await page.setViewportSize({ width: 320, height: 720 })
  return { f, ...(await openFold(page)) }
}

async function openFold(page: Page) {
  await page.goto('/settings?tab=printing')
  await page.locator('details.label-templates-fold summary').click()
  const e = openFoldLocators(page)
  await expect(e.zpl).toBeVisible()
  return e
}

/** Locators for the (already open) editor, valid across a refresh remount. */
function openFoldLocators(page: Page) {
  const editor = page.locator('.label-template-editor')
  const zpl = editor.locator('textarea[id^="template-zpl-"]')
  return {
    editor,
    zpl,
    name: editor.locator('input[id^="template-name-"]'),
    kindSelect: page.locator('#template-kind'),
    copy: editor.getByRole('button', {
      name: d.printing.copyBuiltin,
      exact: true,
    }),
    save: editor.getByRole('button', {
      name: d.printing.saveTemplate,
      exact: true,
    }),
    reset: editor.getByRole('button', {
      name: d.printing.useBuiltin,
      exact: true,
    }),
    reload: editor.getByRole('button', { name: d.intake.reload, exact: true }),
    retry: editor.getByRole('button', { name: d.intake.retry, exact: true }),
    alert: editor.getByRole('alert'),
    status: editor.getByRole('status'),
  }
}

type Editor = Awaited<ReturnType<typeof openFold>>

/** Nothing may be resent: every write control and the kind switch are frozen. */
async function expectFrozen(e: Editor) {
  await expect(e.alert).toHaveText(d.printing.templateUncertain)
  for (const control of [e.zpl, e.name, e.copy, e.save, e.kindSelect])
    await expect(control).toBeDisabled()
  if ((await e.reset.count()) > 0) await expect(e.reset).toBeDisabled()
  await expect(e.reload).toBeVisible()
  await expect(e.retry).toHaveCount(0)
}

/** Lets one intake command commit and replaces its reply. */
async function replaceReply(
  page: Page,
  action: 'setLabelTemplate' | 'resetLabelTemplate',
  reply: { status: number; body: unknown },
  fetchFirst = true,
) {
  const seen: Record<string, unknown>[] = []
  let real: { status: number; body: unknown } | undefined
  await page.route('**/api/intake', async (route) => {
    const command = route.request().postDataJSON()
    if (command?.action !== action) return route.continue()
    seen.push(command)
    if (seen.length !== 1) return route.continue()
    if (fetchFirst) {
      const response = await route.fetch()
      real = { status: response.status(), body: await response.json() }
    }
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    })
  })
  return { seen, real: () => real }
}

async function versions(f: Awaited<ReturnType<typeof p2Fixture>>) {
  return (
    await f.db.query(
      "select version, active, zpl from label_templates where tenant_id=$1 and kind='item' order by version",
      [f.tenant],
    )
  ).rows as { version: number; active: boolean; zpl: string }[]
}

test('a lost save reply freezes the editor and a reload shows the one saved version', async ({
  page,
}) => {
  const { f, ...e } = await openEditor(
    page,
    `template-lost-save-${randomUUID()}@example.test`,
  )
  try {
    await e.zpl.fill(VALID)
    const lost = await replaceReply(page, 'setLabelTemplate', {
      status: 503,
      body: { error: 'REQUEST_FAILED' },
    })
    await e.save.click()
    await expectFrozen(e)
    expect(lost.real()!.status).toBe(200)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    // The store holds exactly one new version; nothing was resent.
    expect(await versions(f)).toEqual([
      { version: 1, active: true, zpl: VALID },
    ])
    expect(lost.seen).toHaveLength(1)
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await e.reload.click()
    const after = await openFold(page)
    await expect(after.editor).toContainText(`${d.printing.templateVersion} 1`)
    await expect(after.zpl).toHaveValue(VALID)
    await expect(after.zpl).toBeEnabled()
    expect(await versions(f)).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('a lost reset reply freezes the editor and a reload shows the built-in layout without an extra version', async ({
  page,
}) => {
  const { f, ...e } = await openEditor(
    page,
    `template-lost-reset-${randomUUID()}@example.test`,
    { custom: true },
  )
  try {
    await expect(e.editor).toContainText(`${d.printing.templateVersion} 1`)
    const lost = await replaceReply(page, 'resetLabelTemplate', {
      status: 503,
      body: { error: 'REQUEST_FAILED' },
    })
    await e.reset.click()
    await expectFrozen(e)
    expect(lost.real()!.body).toEqual({
      ok: true,
      commandId: lost.seen[0].requestId,
      id: true,
      notifications: [],
    })
    expect((await versions(f)).map((v) => [v.version, v.active])).toEqual([
      [1, true],
      [2, false],
    ])
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await e.reload.click()
    const after = await openFold(page)
    await expect(after.editor).toContainText(d.printing.templateBuiltinHint)
    await expect(after.reset).toHaveCount(0)
    expect(await versions(f)).toHaveLength(2)
  } finally {
    await f.close()
  }
})

test('a reset that finds the built-in layout already restored shows the store, not the page memory', async ({
  page,
}) => {
  const { f, ...e } = await openEditor(
    page,
    `template-reset-false-${randomUUID()}@example.test`,
    { custom: true },
  )
  try {
    await expect(e.editor).toContainText(`${d.printing.templateVersion} 1`)
    // The same owner restores the built-in layout in another session while
    // this page still shows version 1.
    await f.asActor(f.actor, async () => {
      const r = await f.db.query(
        "select reset_label_template($1,'item') done",
        [f.tenant],
      )
      expect(r.rows[0].done).toBe(true)
    })
    const answered = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'resetLabelTemplate',
    )
    await e.reset.click()
    const reply = await answered
    expect(reply.status()).toBe(200)
    expect((await reply.json()).id).toBe(false)
    // Confirmed: the refreshed editor shows the built-in layout, no reset.
    const after = openFoldLocators(page)
    await expect(after.editor).toContainText(d.printing.templateBuiltinHint)
    await expect(after.reset).toHaveCount(0)
    await expect(after.zpl).toHaveValue('')
    await expect(after.zpl).toBeEnabled()
    await expect(after.alert).toHaveCount(0)
    expect((await versions(f)).map((v) => [v.version, v.active])).toEqual([
      [1, true],
      [2, false],
    ])
  } finally {
    await f.close()
  }
})

test('while a save is in flight the editor and the kind switch wait for the outcome', async ({
  page,
}) => {
  const { f, ...e } = await openEditor(
    page,
    `template-held-${randomUUID()}@example.test`,
  )
  try {
    await e.zpl.fill(VALID)
    // Hold the actual reply until the frozen state has been observed.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON()?.action !== 'setLabelTemplate')
        return route.continue()
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })
    await e.save.click()
    // The save button now reads "Saving…", so find it by its primary style.
    const saving = e.editor.locator('.row.wrap button.btn-primary')
    await expect(saving).toHaveText(d.intake.busy)
    for (const control of [
      e.zpl,
      e.name,
      e.copy,
      saving,
      e.kindSelect,
      e.editor.getByRole('button', { name: d.printing.preview, exact: true }),
    ])
      await expect(control).toBeDisabled()
    await expect(e.reload).toHaveCount(0)
    release()
    await expect(e.status).toHaveText(d.printing.templateSaved)
    const after = openFoldLocators(page)
    await expect(after.kindSelect).toBeEnabled()
    await expect(after.editor).toContainText(`${d.printing.templateVersion} 1`)
    expect(await versions(f)).toEqual([
      { version: 1, active: true, zpl: VALID },
    ])
  } finally {
    await f.close()
  }
})

test('an actual validation refusal keeps the fields correctable with its own message', async ({
  page,
}) => {
  const { f, ...e } = await openEditor(
    page,
    `template-invalid-${randomUUID()}@example.test`,
  )
  try {
    const refused = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'setLabelTemplate',
    )
    await e.zpl.fill('^XA^FO10,10^FDno reference^FS^XZ')
    await e.save.click()
    const reply = await refused
    expect(reply.status()).toBe(400)
    expect((await reply.json()).error).toBe('LABEL_TEMPLATE_REFERENCE')
    await expect(e.alert).toHaveText(
      d.printing.templateErrors.LABEL_TEMPLATE_REFERENCE,
    )
    for (const control of [e.zpl, e.name, e.copy, e.save, e.kindSelect])
      await expect(control).toBeEnabled()
    await expect(e.reload).toHaveCount(0)
    expect(await versions(f)).toHaveLength(0)
    await e.zpl.fill(VALID)
    await e.save.click()
    await expect(e.status).toHaveText(d.printing.templateSaved)
    expect(await versions(f)).toEqual([
      { version: 1, active: true, zpl: VALID },
    ])
  } finally {
    await f.close()
  }
})

test('a damaged success envelope is not a confirmation', async ({ page }) => {
  const { f, ...e } = await openEditor(
    page,
    `template-malformed-${randomUUID()}@example.test`,
  )
  try {
    await e.zpl.fill(VALID)
    const lost = await replaceReply(page, 'setLabelTemplate', {
      status: 200,
      body: { ok: true, id: {} },
    })
    await e.save.click()
    await expectFrozen(e)
    expect(lost.real()!.status).toBe(200)
    expect(await versions(f)).toHaveLength(1)
    expect(lost.seen).toHaveLength(1)
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await e.reload.click()
    const after = await openFold(page)
    await expect(after.editor).toContainText(`${d.printing.templateVersion} 1`)
    expect(await versions(f)).toHaveLength(1)
  } finally {
    await f.close()
  }
})

for (const action of ['setLabelTemplate', 'resetLabelTemplate'] as const)
  test(`a ${action} reply for a different command cannot confirm this editor`, async ({
    page,
  }) => {
    const { f, ...e } = await openEditor(
      page,
      `template-command-${randomUUID()}@example.test`,
      { custom: action === 'resetLabelTemplate' },
    )
    try {
      let requests = 0
      await page.route('**/api/intake', async (route) => {
        if (route.request().postDataJSON()?.action !== action)
          return route.continue()
        requests++
        const reply = await route.fetch()
        expect(reply.status()).toBe(200)
        await route.fulfill({
          response: reply,
          json: { ...(await reply.json()), commandId: randomUUID() },
        })
      })
      if (action === 'setLabelTemplate') {
        await e.zpl.fill(VALID)
        await e.save.click()
      } else await e.reset.click()
      await expectFrozen(e)
      expect(requests).toBe(1)
      expect(
        (await versions(f)).map((row) => [row.version, row.active]),
      ).toEqual(
        action === 'setLabelTemplate'
          ? [[1, true]]
          : [
              [1, true],
              [2, false],
            ],
      )
    } finally {
      await f.close()
    }
  })
