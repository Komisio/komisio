import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import {
  createVoucher,
  kronor,
  voucherBody,
} from '../../extensions/fortnox/vouchers'
import { sendExportToFortnox } from '../../lib/engine/fortnox-vouchers'

const tenant = '10000000-0000-4000-8000-000000000001'
const exportId = '30000000-0000-4000-8000-000000000003'
const requestId = '40000000-0000-4000-8000-000000000004'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  FORTNOX_CLIENT_ID: 'synthetic-client',
  FORTNOX_CLIENT_SECRET: 'synthetic-secret',
  FORTNOX_PILOT_TENANT_ID: tenant,
  FORTNOX_EXPECTED_COMPANY_NAME: 'Komisio Test',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const company = (DatabaseNumber: string) =>
  json({
    CompanyInformation: {
      CompanyName: 'Komisio Test',
      OrganizationNumber: '',
      DatabaseNumber,
    },
  })
const lines = [
  {
    key: 'grossOre',
    account: '1930',
    side: 'debit' as const,
    amountOre: 20000,
  },
  {
    key: 'sellerCreditOre',
    account: '2890',
    side: 'credit' as const,
    amountOre: 12345,
  },
  {
    key: 'commissionOre',
    account: '3010',
    side: 'credit' as const,
    amountOre: 7655,
  },
]
const opened = {
  dispatchAllowed: true,
  sendId: requestId,
  exportId,
  status: 'pending',
  databaseNumber: '1751085',
  voucherSeries: '',
  voucherNumber: null,
  financialYear: null,
  errorCode: '',
  detail: '',
  closeDate: '2026-09-10',
  closeVersion: 1,
  lines,
  debitOre: 20000,
  creditOre: 20000,
}
const connection = {
  databaseNumber: '1751085',
  companyName: 'Komisio Test',
  organisationNumber: '',
  cipher: seal(
    'fortnox-connection',
    { accessToken: 'a', refreshToken: 'r' },
    env,
  ),
  scope: '',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
}

function client(
  beginState: Record<string, unknown> = opened,
  completionFailure = false,
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    if (fn === 'complete_fortnox_send' && completionFailure)
      throw new Error('Database acknowledgement unavailable')
    if (fn === 'tenant_role') return { data: 'owner', error: null }
    if (fn === 'read_fortnox_connection')
      return { data: connection, error: null }
    if (fn === 'begin_fortnox_send') return { data: beginState, error: null }
    if (fn === 'complete_fortnox_send')
      return {
        data: {
          ...opened,
          status: args.p_status,
          voucherSeries: args.p_series,
          voucherNumber: args.p_number,
          financialYear: args.p_year,
          errorCode: args.p_error,
          detail: args.p_detail,
        },
        error: null,
      }
    return { data: null, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, calls }
}

describe('voucher body', () => {
  it('converts öre to kronor with two decimals and keeps the tenant accounts', () => {
    expect(kronor(12345)).toBe(123.45)
    expect(kronor(0)).toBe(0)
    expect(() => kronor(1.5)).toThrow('INVALID_INPUT')
    const body = voucherBody({
      transactionDate: '2026-09-10',
      description: 'Dagsavslut 2026-09-10 v1',
      lines,
    })
    expect(body.Voucher.VoucherSeries).toBe('A')
    expect(body.Voucher.VoucherRows).toEqual([
      { Account: 1930, Debit: 200, Credit: 0 },
      { Account: 2890, Debit: 0, Credit: 123.45 },
      { Account: 3010, Debit: 0, Credit: 76.55 },
    ])
    expect(() =>
      voucherBody({ transactionDate: '10/09/2026', description: '', lines }),
    ).toThrow('INVALID_INPUT')
    expect(() =>
      voucherBody({
        transactionDate: '2026-09-10',
        description: '',
        lines: [{ ...lines[0], account: '19300' }],
      }),
    ).toThrow('INVALID_INPUT')
  })
  it('reports a rejection with the Fortnox message', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          { ErrorInformation: { Code: 2000663, Message: 'Kontot finns inte' } },
          400,
        ),
      )
    await expect(
      createVoucher(
        'tok',
        { transactionDate: '2026-09-10', description: 'x', lines },
        http,
      ),
    ).rejects.toMatchObject({
      message: 'FORTNOX_VOUCHER_REJECTED',
      detail: 'Kontot finns inte',
    })
  })
})

describe('sendExportToFortnox', () => {
  it('does not repeat a pending send after a lost begin response', async () => {
    const http = vi.fn<typeof fetch>()
    const setup = client({ ...opened, dispatchAllowed: false })
    await expect(
      sendExportToFortnox(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('FORTNOX_SEND_IN_PROGRESS')
    expect(http).not.toHaveBeenCalled()
    expect(
      setup.calls.some((call) => call.fn === 'complete_fortnox_send'),
    ).toBe(false)
  })
  it('fails closed while the old begin RPC has no dispatch permission', async () => {
    const { dispatchAllowed: ignored, ...legacy } = opened
    expect(ignored).toBe(true)
    const http = vi.fn<typeof fetch>()
    await expect(
      sendExportToFortnox(
        client(legacy).client,
        tenant,
        exportId,
        requestId,
        env,
        http,
      ),
    ).rejects.toThrow('FORTNOX_SEND_IN_PROGRESS')
    expect(http).not.toHaveBeenCalled()
  })
  it('holds a lost POST response rather than treating it as retryable', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('1751085'))
      .mockRejectedValueOnce(
        new Error('Connection lost after provider committed'),
      )
    const setup = client()
    await expect(
      sendExportToFortnox(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('FORTNOX_OUTCOME_UNKNOWN')
    const finished = setup.calls.find(
      (call) => call.fn === 'complete_fortnox_send',
    )!
    expect(finished.args.p_error).toBe('FORTNOX_OUTCOME_UNKNOWN')
    expect(finished.args.p_detail).toBe('')
  })
  it('holds a successful POST when local acknowledgement fails', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('1751085'))
      .mockResolvedValueOnce(
        json(
          { Voucher: { VoucherSeries: 'A', VoucherNumber: 42, Year: 3 } },
          201,
        ),
      )
    const setup = client(opened, true)
    await expect(
      sendExportToFortnox(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('FORTNOX_OUTCOME_UNKNOWN')
    expect(http).toHaveBeenCalledTimes(2)
  })
  it('sends the recorded lines and records series and number', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('1751085'))
      .mockResolvedValueOnce(
        json(
          { Voucher: { VoucherSeries: 'A', VoucherNumber: 42, Year: 3 } },
          201,
        ),
      )
    const { client: c, calls } = client()
    const result = await sendExportToFortnox(
      c,
      tenant,
      exportId,
      requestId,
      env,
      http,
    )
    expect(result.status).toBe('sent')
    expect(result.voucherNumber).toBe(42)
    const post = http.mock.calls[1]
    expect(String(post[0])).toBe('https://api.fortnox.se/3/vouchers')
    const sent = JSON.parse(String((post[1] as RequestInit).body))
    expect(sent.Voucher.TransactionDate).toBe('2026-09-10')
    expect(sent.Voucher.Description).toBe('Dagsavslut 2026-09-10 v1')
    expect(sent.Voucher.VoucherRows).toHaveLength(3)
    const done = calls.find((x) => x.fn === 'complete_fortnox_send')!
    expect(done.args.p_status).toBe('sent')
    expect(done.args.p_number).toBe(42)
  })
  it('refuses when another company database answers and records the failure without posting', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(company('1'))
    const { client: c, calls } = client()
    await expect(
      sendExportToFortnox(c, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('FORTNOX_WRONG_COMPANY')
    expect(http).toHaveBeenCalledTimes(1)
    const done = calls.find((x) => x.fn === 'complete_fortnox_send')!
    expect(done.args.p_status).toBe('failed')
    expect(done.args.p_error).toBe('FORTNOX_PREFLIGHT_FAILED')
    expect(done.args.p_detail).toBe('')
  })
  it('holds any failed POST without persisting its provider body', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('1751085'))
      .mockResolvedValueOnce(
        json({ ErrorInformation: { message: 'Räkenskapsår saknas' } }, 400),
      )
    const { client: c, calls } = client()
    await expect(
      sendExportToFortnox(c, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('FORTNOX_OUTCOME_UNKNOWN')
    const done = calls.find((x) => x.fn === 'complete_fortnox_send')!
    expect(done.args.p_error).toBe('FORTNOX_OUTCOME_UNKNOWN')
    expect(done.args.p_detail).toBe('')
  })
  it('returns the recorded state on replay without contacting Fortnox', async () => {
    const http = vi.fn<typeof fetch>()
    const { client: c } = client({
      ...opened,
      status: 'sent',
      voucherSeries: 'A',
      voucherNumber: 42,
    })
    const result = await sendExportToFortnox(
      c,
      tenant,
      exportId,
      requestId,
      env,
      http,
    )
    expect(result.status).toBe('sent')
    expect(http).not.toHaveBeenCalled()
  })
})
