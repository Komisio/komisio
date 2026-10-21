import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAccountingAssistance } from '../../lib/engine/accounting-assistance'
import { economicCatalogue } from '../../lib/engine/economic'
import { generateAccountSuggestions } from '../../lib/assistance/accounting'
vi.mock('../../lib/assistance/reception-config', () => ({
  resolveReceptionAssistance: vi.fn(async () => ({
    model: 'fixture',
    key: 'synthetic',
  })),
}))
vi.mock('../../lib/engine/economic', () => ({ economicCatalogue: vi.fn() }))
vi.mock('../../lib/assistance/accounting', () => ({
  generateAccountSuggestions: vi.fn(),
}))
const tenantId = 'f0000000-0000-4000-8000-000000005561',
  requestId = 'f0000000-0000-4000-8000-000000005562',
  revision = 'f0000000-0000-4000-8000-000000005563'
const command = {
  tenantId,
  requestId,
  baseId: null,
  language: 'dk',
  destination: 'economic',
  agreementNumber: 123456,
}
const accounts = [{ account: '10000', name: 'Bank', type: 'status' }]
const context = {
  destination: 'economic',
  agreementNumber: 123456,
  connectionRevision: revision,
  currentMap: {},
  accounts,
}
const output = {
  rows: [
    { key: 'grossOre', account: '10000', side: 'debit', reason: 'Review' },
  ],
  warnings: [],
}
function client(prior: unknown, reserved: boolean, currentMap: unknown = {}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: prior, error: null })),
  }
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'begin_economic_accounting_assistance'
        ? {
            reserved,
            status: reserved ? 'pending' : 'ready',
            output: reserved ? null : output,
            context: { ...context, currentMap },
          }
        : null,
    error: null,
  }))
  return {
    value: { from: vi.fn(() => query), rpc } as unknown as SupabaseClient,
    rpc,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(economicCatalogue).mockResolvedValue({
    agreementNumber: 123456,
    connectionRevision: revision,
    accounts: [
      {
        accountNumber: 10000,
        name: 'Bank',
        accountType: 'status',
        barred: false,
        blockDirectEntries: false,
      },
      {
        accountNumber: 20000,
        name: 'Blocked',
        accountType: 'status',
        barred: true,
        blockDirectEntries: false,
      },
    ],
    journals: [],
    vatAccounts: [],
  })
  vi.mocked(generateAccountSuggestions).mockResolvedValue({
    output: output as never,
    usage: { input_tokens: 100, output_tokens: 20 },
  })
})
it('reserves using server-fetched eligible accounts and connection revision', async () => {
  const c = client(null, true)
  const result = await runAccountingAssistance(
    c.value,
    command,
    new AbortController().signal,
  )
  expect(c.rpc.mock.calls[0]).toEqual([
    'begin_economic_accounting_assistance',
    expect.objectContaining({
      p_accounts: accounts,
      p_revision: revision,
      p_agreement: 123456,
    }),
  ])
  expect(result.status).toBe('ready')
  expect(generateAccountSuggestions).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    fetch,
    'economic',
  )
})
it('recovers a saved attempt without reading the provider or generating twice', async () => {
  const c = client({ context }, false)
  expect(
    (
      await runAccountingAssistance(
        c.value,
        command,
        new AbortController().signal,
      )
    ).output,
  ).toEqual(output)
  expect(economicCatalogue).not.toHaveBeenCalled()
  expect(generateAccountSuggestions).not.toHaveBeenCalled()
  expect(c.rpc).toHaveBeenCalledTimes(1)
})
it('refuses an agreement change before reserving credits', async () => {
  const c = client(null, true)
  await expect(
    runAccountingAssistance(
      c.value,
      { ...command, agreementNumber: 999999 },
      new AbortController().signal,
    ),
  ).rejects.toThrow('REQUEST_CONFLICT')
  expect(c.rpc).not.toHaveBeenCalled()
})
it('does not complete suggestions that overwrite an existing map row', async () => {
  const c = client(null, true, {
    grossOre: { excludeReason: 'Already posted' },
  })
  expect(
    (
      await runAccountingAssistance(
        c.value,
        command,
        new AbortController().signal,
      )
    ).status,
  ).toBe('failed')
  expect(c.rpc).toHaveBeenLastCalledWith(
    'complete_accounting_assistance',
    expect.objectContaining({
      p_output: null,
      p_input: 100,
      p_output_tokens: 20,
    }),
  )
})
