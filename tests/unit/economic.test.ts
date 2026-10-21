import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createDrafts,
  draftBody,
  economicIssue,
  grantUrl,
  readAgreement,
  readCatalogue,
  validateMapping,
  serializeDraftBody,
  type Catalogue,
} from '../../extensions/economic/api'
import {
  completeEconomicConnection,
  economicMapBody,
  economicErrors,
  sendEconomicExport,
  startEconomicConnection,
} from '../../lib/engine/economic'
import { open, seal, signState } from '../../lib/platform/credentials'
import { dictionary, locales } from '../../lib/i18n'
import { confirmsEconomicResult } from '../../components/intake/economic-result'

const tenant = '10000000-0000-4000-8000-000000000523'
const user = '20000000-0000-4000-8000-000000000523'
const send = '30000000-0000-4000-8000-000000000523'
const exportId = '40000000-0000-4000-8000-000000000523'
const revision = '50000000-0000-4000-8000-000000000523'
const env = {
  ECONOMIC_APP_SECRET_TOKEN: 'synthetic-secret',
  ECONOMIC_APP_PUBLIC_TOKEN: 'synthetic-public',
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
}
const credentials = {
  appSecret: env.ECONOMIC_APP_SECRET_TOKEN,
  grant: 'synthetic-grant',
}
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers })
const self = {
  agreementNumber: 123456,
  company: {
    name: 'Synthetic company',
    companyIdentificationNumber: '12345678',
  },
  settings: { baseCurrency: 'DKK' },
}
const catalogue: Catalogue = {
  accounts: [10000, 30000].map((n) => ({
    accountNumber: n,
    name: `Account ${n}`,
    accountType: 'status',
    barred: false,
    blockDirectEntries: false,
  })),
  vatAccounts: [
    { vatCode: 'Z0', name: 'Zero', ratePercentage: 0, barred: false },
  ],
  journals: [
    {
      number: 1,
      name: 'Daily exports',
      isStandingJournal: false,
      allowedEntryType: 5,
    },
  ],
}
const lines = [
  {
    key: 'grossOre',
    account: '10000',
    side: 'debit' as const,
    amountOre: 12345,
    vatCode: 'Z0',
  },
  {
    key: 'commissionOre',
    account: '30000',
    side: 'credit' as const,
    amountOre: 12345,
    vatCode: 'Z0',
  },
]
const body = draftBody({
  journalNumber: 1,
  date: '2026-10-20',
  description: 'Synthetic daily export',
  lines,
})
const opened = {
  sendId: send,
  exportId,
  status: 'pending',
  agreementNumber: 123456,
  journalNumber: 1,
  voucherNumber: null,
  errorCode: '',
  reason: '',
  retryAfter: null,
  closeDate: '2026-10-20',
  closeVersion: 1,
  lines,
  createdAt: '2026-10-20T10:00:00Z',
  dispatchAllowed: true,
}
function fakeClient(
  options: {
    role?: string
    begin?: object
    completionFailure?: boolean
    userId?: string
    connectionRevision?: () => string
  } = {},
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    let data: unknown = null
    if (name === 'tenant_role') data = options.role ?? 'owner'
    if (name === 'store_currency') data = 'DKK'
    if (name === 'economic_connection_status')
      data = {
        connected: false,
        agreementNumber: null,
        companyName: null,
        organisationNumber: null,
        connectedAt: null,
        events: [],
      }
    if (name === 'read_economic_connection')
      data = {
        agreementNumber: 123456,
        revision: options.connectionRevision?.() ?? revision,
        cipher: seal(
          `economic-connection:${tenant}`,
          { grant: credentials.grant },
          env,
        ),
      }
    if (name === 'begin_economic_send') data = { ...opened, ...options.begin }
    if (name === 'complete_economic_send') {
      if (options.completionFailure)
        throw new Error('lost database acknowledgement')
      data = {
        ...opened,
        status: args.p_status,
        voucherNumber: args.p_number,
        errorCode: args.p_error,
        reason: args.p_reason,
        dispatchAllowed: false,
      }
    }
    return { data, error: null }
  })
  return {
    client: {
      rpc,
      auth: {
        getUser: async () => ({
          data: { user: { id: options.userId ?? user } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient,
    rpc,
  }
}
function provider(
  options: {
    postStatus?: number
    differentVoucher?: boolean
    alteredAmount?: boolean
    zeroRate?: number
    readStatus?: number
    years?: object[]
    missingLine?: boolean
    extraLine?: boolean
    foreignEntry?: boolean
    wrongYear?: boolean
    lostReply?: boolean
    readBackStatus?: number
    automaticVat?: boolean
    contraAccount?: boolean
  } = {},
) {
  let entries = body.entries
  let voucher: Record<string, unknown>
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/self')) return json(self, options.readStatus ?? 200)
    if (url.includes('/accounts?'))
      return json({ collection: catalogue.accounts })
    if (url.includes('/vat-accounts?'))
      return json({
        collection: [
          {
            ...catalogue.vatAccounts[0],
            ratePercentage: options.zeroRate ?? 0,
          },
        ],
      })
    if (url.endsWith('/journals')) return json({ items: catalogue.journals })
    if (url.includes('/accounting-years?'))
      return json({
        collection: options.years ?? [
          { year: '2026', fromDate: '2026-01-01', toDate: '2026-12-31' },
        ],
      })
    if (url.endsWith('/journals/1/vouchers') && init?.method === 'POST') {
      const sent = JSON.parse(String(init.body))
      const rows = sent.entries.financeVouchers.map(
        (row: object, i: number) => ({
          ...row,
          voucher: { voucherNumber: options.differentVoucher ? 42 + i : 42 },
          ...(options.alteredAmount ? { amount: 1 } : {}),
          ...(options.automaticVat ? { vatAmount: 30 } : {}),
          ...(options.contraAccount
            ? { contraAccount: { accountNumber: 99999 } }
            : {}),
        }),
      )
      if (options.missingLine) rows.pop()
      if (options.extraLine) rows.push(rows[0])
      voucher = {
        ...sent,
        voucherNumber: 42,
        accountingYear: options.wrongYear
          ? { year: 'wrong' }
          : sent.accountingYear,
        entries: {
          financeVouchers: rows,
          ...(options.foreignEntry ? { supplierPayments: [{}] } : {}),
        },
      }
      if (options.lostReply) throw new Error('lost response after creation')
      return json({ ...sent, voucherNumber: 42 }, options.postStatus ?? 201)
    }
    if (/\/journals\/1\/vouchers\/[^/]+-42$/.test(url))
      return json(voucher, options.readBackStatus ?? 200)
    if (url.endsWith('/bulk')) {
      entries = JSON.parse(String(init?.body)).entries
      return json({ entryNumbers: [10, 11] }, options.postStatus ?? 201)
    }
    const id = Number(url.split('/').at(-1))
    return json({
      ...entries[id - 10],
      entryNumber: id,
      // The Journals bulk API allocates a number PER entry when omitted.
      voucherNumber: id,
      ...(options.alteredAmount ? { amount: 1 } : {}),
    })
  })
}
describe('e-conomic adapter and sending', () => {
  it('does not treat empty or malformed successful HTTP bodies as confirmed writes', () => {
    expect(confirmsEconomicResult('export', {})).toBe(false)
    expect(confirmsEconomicResult('send', { ...opened, status: 'sent' })).toBe(
      false,
    )
    expect(
      confirmsEconomicResult('send', {
        ...opened,
        status: 'sent',
        voucherNumber: 42,
      }),
    ).toBe(true)
    expect(confirmsEconomicResult('publishMap', { id: exportId })).toBe(true)
  })
  it('keeps decimal serialization exact up to the integer ore boundary', () => {
    const large = draftBody({
      journalNumber: 1,
      date: '2026-10-20',
      description: 'Synthetic maximum',
      lines: lines.map((line) => ({
        ...line,
        amountOre: Number.MAX_SAFE_INTEGER,
      })),
    })
    expect(serializeDraftBody(large, '2026')).toContain(
      '"amount":90071992547409.91',
    )
    expect(serializeDraftBody(large, '2026')).toContain(
      '"amount":-90071992547409.91',
    )
  })
  it('rejects automatic contra accounts before the external attempt', () => {
    expect(() =>
      validateMapping(
        {
          ...catalogue,
          accounts: catalogue.accounts.map((a) => ({
            ...a,
            contraAccount: { accountNumber: 99999 },
          })),
        },
        1,
        lines,
      ),
    ).toThrow('ECONOMIC_ACCOUNT_INVALID')
  })
  it('provides guidance for every allowlisted outcome in all eight languages', () => {
    for (const locale of locales)
      for (const code of economicErrors)
        expect(
          (dictionary(locale).economic.errors as Record<string, string>)[code],
          `${locale}: ${code}`,
        ).toBeTruthy()
  })
  it('uses only pinned API origins, token headers, bounded requests and draft-only writes', async () => {
    const http = provider()
    expect(await readAgreement(credentials, http)).toMatchObject({
      agreementNumber: 123456,
      currency: 'DKK',
    })
    const list = await readCatalogue(credentials, http)
    validateMapping(list, 1, lines)
    const attempted = vi.fn()
    expect(
      await createDrafts(credentials, body, send, attempted, http),
    ).toEqual({ voucherNumber: 42 })
    expect(attempted).toHaveBeenCalledOnce()
    const post = http.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(post).toHaveLength(1)
    expect(post[0][0]).toBe('https://restapi.e-conomic.com/journals/1/vouchers')
    expect(post[0][1]?.headers).toMatchObject({
      'Idempotency-Key': `komisio-${send}`,
    })
    expect(post[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' })
    expect(JSON.parse(String(post[0][1]?.body))).toMatchObject({
      accountingYear: { year: '2026' },
      journal: { journalNumber: 1 },
    })
    expect(JSON.parse(String(post[0][1]?.body))).not.toHaveProperty(
      'voucherNumber',
    )
    expect(body.entries.map((e) => e.amount)).toEqual(['123.45', '-123.45'])
    expect(
      JSON.parse(String(post[0][1]?.body)).entries.financeVouchers.map(
        (e: { amount: number }) => e.amount,
      ),
    ).toEqual([123.45, -123.45])
    expect(
      body.entries.every((e) => e.vatCode === 'Z0' && !('voucherNumber' in e)),
    ).toBe(true)
    expect(
      http.mock.calls.every(([url]) => !String(url).includes('/book')),
    ).toBe(true)
  })
  it.each([
    [
      'barred account',
      {
        ...catalogue,
        accounts: catalogue.accounts.map((a) => ({ ...a, barred: true })),
      },
      'ECONOMIC_ACCOUNT_INVALID',
    ],
    [
      'blocked direct entries',
      {
        ...catalogue,
        accounts: catalogue.accounts.map((a) => ({
          ...a,
          blockDirectEntries: true,
        })),
      },
      'ECONOMIC_ACCOUNT_INVALID',
    ],
    [
      'automatic VAT',
      {
        ...catalogue,
        vatAccounts: [{ ...catalogue.vatAccounts[0], ratePercentage: 25 }],
      },
      'ECONOMIC_ZERO_VAT_REQUIRED',
    ],
    [
      'standing journal',
      {
        ...catalogue,
        journals: [{ ...catalogue.journals[0], isStandingJournal: true }],
      },
      'ECONOMIC_JOURNAL_INVALID',
    ],
  ])('refuses %s before sending', (_name, list, error) => {
    expect(() => validateMapping(list as Catalogue, 1, lines)).toThrow(
      String(error),
    )
  })
  it('refuses invalid dates, unsafe amounts and unbalanced data before dispatch', () => {
    expect(() =>
      draftBody({
        journalNumber: 1,
        date: '2026-02-31',
        description: 'x',
        lines,
      }),
    ).toThrow()
    expect(() =>
      draftBody({
        journalNumber: 1,
        date: '2026-10-20',
        description: 'x',
        lines: [
          { ...lines[0], amountOre: Number.MAX_SAFE_INTEGER + 1 },
          lines[1],
        ],
      }),
    ).toThrow()
    expect(() =>
      draftBody({
        journalNumber: 1,
        date: '2026-10-20',
        description: 'x',
        lines: [{ ...lines[0], amountOre: 1 }, lines[1]],
      }),
    ).toThrow('VOUCHER_UNBALANCED')
  })
  it.each([401, 403, 429, 500])(
    'holds every attempted POST error including %i without replay',
    async (status) => {
      const c = fakeClient()
      const http = provider({ postStatus: status })
      const result = await sendEconomicExport(
        c.client,
        tenant,
        exportId,
        send,
        env,
        http,
      )
      expect(result.errorCode).toBe('ECONOMIC_OUTCOME_UNKNOWN')
      expect(
        http.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(1)
    },
  )
  it.each([
    { differentVoucher: true },
    { alteredAmount: true },
    { missingLine: true },
    { extraLine: true },
    { foreignEntry: true },
    { wrongYear: true },
    { lostReply: true },
    { readBackStatus: 500 },
    { automaticVat: true },
    { contraAccount: true },
  ])('holds an unverified created set %j', async (options) => {
    const c = fakeClient()
    expect(
      (
        await sendEconomicExport(
          c.client,
          tenant,
          exportId,
          send,
          env,
          provider(options),
        )
      ).errorCode,
    ).toBe('ECONOMIC_OUTCOME_UNKNOWN')
  })
  it('groups a four-line close in the provider fiscal year without allocating a number locally', async () => {
    const http = provider({
      years: [
        { year: '2026/27', fromDate: '2026-07-01', toDate: '2027-06-30' },
      ],
    })
    const four = draftBody({
      journalNumber: 1,
      date: '2026-10-21',
      description: 'Synthetic four-line close',
      lines: [
        { ...lines[0], amountOre: 15000 },
        { ...lines[0], amountOre: 10000 },
        { ...lines[1], amountOre: 22000 },
        { ...lines[1], amountOre: 3000 },
      ],
    })
    await expect(
      createDrafts(credentials, four, send, vi.fn(), http),
    ).resolves.toEqual({ voucherNumber: 42 })
    const posts = http.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(1)
    const payload = JSON.parse(String(posts[0][1]?.body))
    expect(payload.accountingYear.year).toBe('2026/27')
    expect(
      payload.entries.financeVouchers.map(
        (row: { amount: number }) => row.amount,
      ),
    ).toEqual([150, 100, -220, -30])
    expect(http.mock.calls.at(-1)?.[0]).toBe(
      'https://restapi.e-conomic.com/journals/1/vouchers/2026%2F27-42',
    )
  })
  it.each([
    { years: [] },
    { years: [{ year: '2025', fromDate: '2025-01-01', toDate: '2025-12-31' }] },
    {
      years: [
        {
          year: '2026',
          fromDate: '2026-01-01',
          toDate: '2026-12-31',
          closed: true,
        },
      ],
    },
    {
      years: [
        { year: '2026', fromDate: '2026-01-01', toDate: '2026-12-31' },
        { year: 'overlap', fromDate: '2026-07-01', toDate: '2027-06-30' },
      ],
    },
  ])(
    'refuses absent, closed or ambiguous accounting years before dispatch: %j',
    async (options) => {
      const http = provider(options)
      const c = fakeClient()
      expect(
        await sendEconomicExport(c.client, tenant, exportId, send, env, http),
      ).toMatchObject({
        errorCode: 'ECONOMIC_PREFLIGHT_FAILED',
        reason: 'ECONOMIC_ACCOUNTING_YEAR_INVALID',
      })
      expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
        false,
      )
    },
  )
  it('permits retry only after a proven preflight failure and sends no POST', async () => {
    const c = fakeClient()
    const http = provider({ zeroRate: 25 })
    const result = await sendEconomicExport(
      c.client,
      tenant,
      exportId,
      send,
      env,
      http,
    )
    expect(result).toMatchObject({
      errorCode: 'ECONOMIC_PREFLIGHT_FAILED',
      reason: 'ECONOMIC_ZERO_VAT_REQUIRED',
    })
    expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
      false,
    )
  })
  it('does not send an old grant when the connection changes during accounting-year lookup', async () => {
    let changed = false
    const c = fakeClient({
      connectionRevision: () => (changed ? exportId : revision),
    })
    const delegate = provider()
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const response = await delegate(url, init)
      if (String(url).includes('/accounting-years?')) changed = true
      return response
    })
    expect(
      await sendEconomicExport(c.client, tenant, exportId, send, env, http),
    ).toMatchObject({
      errorCode: 'ECONOMIC_PREFLIGHT_FAILED',
      reason: 'ECONOMIC_WRONG_AGREEMENT',
    })
    expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
      false,
    )
  })
  it('records a confirmed single voucher and never dispatches a pending replay', async () => {
    const c = fakeClient()
    expect(
      (
        await sendEconomicExport(
          c.client,
          tenant,
          exportId,
          send,
          env,
          provider(),
        )
      ).status,
    ).toBe('sent')
    const replay = fakeClient({ begin: { dispatchAllowed: false } })
    const http = provider()
    await expect(
      sendEconomicExport(replay.client, tenant, exportId, send, env, http),
    ).rejects.toThrow('ECONOMIC_SEND_IN_PROGRESS')
    expect(http).not.toHaveBeenCalled()
  })
  it('keeps the claim held when completion cannot be recorded', async () => {
    const c = fakeClient({ completionFailure: true })
    const http = provider()
    await expect(
      sendEconomicExport(c.client, tenant, exportId, send, env, http),
    ).rejects.toThrow('ECONOMIC_OUTCOME_UNKNOWN')
    expect(
      http.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1)
  })
  it('honours Retry-After without any blind request retry', async () => {
    const http = vi.fn<typeof fetch>(async () =>
      json({}, 429, { 'Retry-After': '120' }),
    )
    await expect(readAgreement(credentials, http)).rejects.toMatchObject({
      message: 'ECONOMIC_RATE_LIMITED',
      retrySeconds: 120,
    })
    expect(http).toHaveBeenCalledOnce()
  })
  it('requires explicit nonempty VAT codes and prevents fee exclusions', () => {
    expect(
      economicMapBody.safeParse({ grossOre: { ...lines[0], vatCode: '' } })
        .success,
    ).toBe(false)
    expect(
      economicMapBody.safeParse({
        'mode:consignment_fee:vatOre': { excludeReason: 'Skip' },
      }).success,
    ).toBe(false)
    expect(
      economicMapBody.safeParse({
        'mode:store_full:vatOre': {
          excludeReason: 'Included in another total',
        },
      }).success,
    ).toBe(true)
  })
})
describe('e-conomic connection', () => {
  it('refuses missing configuration and non-admin roles before any grant request', async () => {
    expect(economicIssue({})).toBe('ECONOMIC_NOT_CONFIGURED')
    await expect(
      startEconomicConnection(
        fakeClient().client,
        tenant,
        'https://example.test/callback',
        'dk',
        {},
      ),
    ).rejects.toThrow('ECONOMIC_NOT_CONFIGURED')
    await expect(
      startEconomicConnection(
        fakeClient({ role: 'staff' }).client,
        tenant,
        'https://example.test/callback',
        'dk',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
    const url = new URL(
      grantUrl('public', 'https://example.test/callback', 'signed', 'dk'),
    )
    expect(url.searchParams.get('locale')).toBe('da-DK')
    expect(
      new URL(url.searchParams.get('redirectUrl')!).searchParams.get('state'),
    ).toBe('signed')
  })
  it('binds the callback to state, cookie, tenant and the initiating user, then seals only the grant', async () => {
    const c = fakeClient()
    const state = signState(
      'economic-connection',
      {
        tenantId: tenant,
        userId: user,
        nonce: 'synthetic',
        agreementNumber: '',
      },
      600,
      env,
    )
    const input = {
      tenantId: tenant,
      grant: credentials.grant,
      state,
      cookieState: state,
    }
    await completeEconomicConnection(c.client, input, env, provider())
    const args = c.rpc.mock.calls.find(
      ([name]) => name === 'store_economic_connection',
    )![1]
    expect(open(`economic-connection:${tenant}`, args.p_cipher, env)).toEqual({
      grant: credentials.grant,
    })
    expect(JSON.stringify(c.rpc.mock.calls)).not.toContain(credentials.grant)
    const http = provider()
    await expect(
      completeEconomicConnection(
        c.client,
        { ...input, cookieState: null },
        env,
        http,
      ),
    ).rejects.toThrow('ECONOMIC_STATE_INVALID')
    await expect(
      completeEconomicConnection(
        fakeClient({ userId: revision }).client,
        input,
        env,
        http,
      ),
    ).rejects.toThrow('ECONOMIC_STATE_INVALID')
    expect(http).not.toHaveBeenCalled()
  })
  it('refuses non-DKK and different pinned agreements without persisting the grant', async () => {
    for (const [agreementNumber, currency, expected] of [
      [123456, 'EUR', 'ECONOMIC_CURRENCY_UNSUPPORTED'],
      [999999, 'DKK', 'ECONOMIC_WRONG_AGREEMENT'],
    ] as const) {
      const c = fakeClient()
      const state = signState(
        'economic-connection',
        { tenantId: tenant, userId: user, agreementNumber: '123456' },
        600,
        env,
      )
      await expect(
        completeEconomicConnection(
          c.client,
          {
            tenantId: tenant,
            grant: credentials.grant,
            state,
            cookieState: state,
          },
          env,
          vi.fn(async () =>
            json({
              ...self,
              agreementNumber,
              settings: { baseCurrency: currency },
            }),
          ),
        ),
      ).rejects.toThrow(expected)
      expect(
        c.rpc.mock.calls.some(([name]) => name === 'store_economic_connection'),
      ).toBe(false)
      expect(
        c.rpc.mock.calls.some(([name]) => name === 'record_economic_check'),
      ).toBe(true)
    }
  })
})
