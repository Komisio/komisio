import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import { spirisEnvironment } from '../../extensions/spiris/auth'
import {
  createVoucher,
  major,
  voucherBody,
} from '../../extensions/spiris/vouchers'
import {
  confirmSpirisVoucher,
  sendExportToSpiris,
} from '../../lib/engine/spiris-vouchers'

const tenant = '10000000-0000-4000-8000-000000000001'
const exportId = '30000000-0000-4000-8000-000000000003'
const requestId = '40000000-0000-4000-8000-000000000004'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SPIRIS_CLIENT_ID: 'synthetic-client',
  SPIRIS_CLIENT_SECRET: 'synthetic-secret',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const company = (CorporateIdentityNumber: string) =>
  json({ Name: 'Komisio Test', CorporateIdentityNumber, CurrencyCode: 'SEK' })
const created = () =>
  json(
    {
      Id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      NumberSeries: 'A',
      NumberAndNumberSeries: 'A42',
      VoucherDate: '2026-09-10',
    },
    201,
  )
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
  companyKey: '5561234567',
  voucherId: '',
  voucherNumber: '',
  errorCode: '',
  detail: '',
  closeDate: '2026-09-10',
  closeVersion: 1,
  lines,
  debitOre: 20000,
  creditOre: 20000,
}
const connection = {
  revision: '1',
  companyKey: '5561234567',
  companyName: 'Komisio Test',
  organisationNumber: '556123-4567',
  currencyCode: 'SEK',
  cipher: seal(
    'spiris-connection',
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
    if (fn === 'complete_spiris_send' && completionFailure)
      throw new Error('Database acknowledgement unavailable')
    if (fn === 'tenant_role') return { data: 'owner', error: null }
    if (fn === 'read_spiris_connection')
      return { data: connection, error: null }
    if (fn === 'begin_spiris_send') return { data: beginState, error: null }
    if (fn === 'complete_spiris_send')
      return {
        data: {
          ...opened,
          status: args.p_status,
          voucherId: args.p_voucher_id,
          voucherNumber: args.p_voucher_number,
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
  it('converts öre to the major unit with two decimals and keeps the tenant accounts', () => {
    expect(major(12345)).toBe(123.45)
    expect(major(0)).toBe(0)
    expect(() => major(1.5)).toThrow('INVALID_INPUT')
    const body = voucherBody({
      transactionDate: '2026-09-10',
      description: 'Dagsavslut 2026-09-10 v1',
      lines,
    })
    expect(body.VoucherDate).toBe('2026-09-10')
    expect(body.VoucherText).toBe('Dagsavslut 2026-09-10 v1')
    expect(body.Rows).toEqual([
      { AccountNumber: 1930, DebitAmount: 200, CreditAmount: 0 },
      { AccountNumber: 2890, DebitAmount: 0, CreditAmount: 123.45 },
      { AccountNumber: 3010, DebitAmount: 0, CreditAmount: 76.55 },
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
  it('reports a rejection with the provider message', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          { ErrorCode: 4000, DeveloperErrorMessage: 'Account 1930 not found' },
          400,
        ),
      )
    await expect(
      createVoucher(
        spirisEnvironment(env),
        'tok',
        { transactionDate: '2026-09-10', description: 'x', lines },
        http,
      ),
    ).rejects.toMatchObject({
      message: 'SPIRIS_VOUCHER_REJECTED',
      detail: 'Account 1930 not found',
    })
  })
})

describe('confirmSpirisVoucher', () => {
  it('records only confirmed-sent evidence through the owner RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { ...opened, status: 'sent' }, error: null })
    const input = {
      tenantId: tenant,
      sendId: requestId,
      voucherNumber: ' A42 ',
      evidence: ' Compared date and lines ',
    }
    await confirmSpirisVoucher({ rpc } as unknown as SupabaseClient, input)
    expect(rpc).toHaveBeenCalledWith('reconcile_spiris_send', {
      p_tenant: tenant,
      p_send_id: requestId,
      p_outcome: 'confirmed_sent',
      p_voucher_id: '',
      p_voucher_number: 'A42',
      p_evidence: 'Compared date and lines',
    })
    await expect(
      confirmSpirisVoucher({ rpc } as unknown as SupabaseClient, {
        ...input,
        evidence: ' ',
      }),
    ).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('sendExportToSpiris', () => {
  it('does not repeat a pending send after a lost begin response', async () => {
    const http = vi.fn<typeof fetch>()
    const setup = client({ ...opened, dispatchAllowed: false })
    await expect(
      sendExportToSpiris(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('SPIRIS_SEND_IN_PROGRESS')
    expect(http).not.toHaveBeenCalled()
    expect(setup.calls.some((call) => call.fn === 'complete_spiris_send')).toBe(
      false,
    )
  })
  it('holds a lost POST response rather than treating it as retryable', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('5561234567'))
      .mockRejectedValueOnce(
        new Error('Connection lost after provider committed'),
      )
    const setup = client()
    await expect(
      sendExportToSpiris(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('SPIRIS_OUTCOME_UNKNOWN')
    const finished = setup.calls.find((c) => c.fn === 'complete_spiris_send')!
    expect(finished.args.p_error).toBe('SPIRIS_OUTCOME_UNKNOWN')
    expect(finished.args.p_detail).toBe('')
  })
  it('holds a successful POST when local acknowledgement fails', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('5561234567'))
      .mockResolvedValueOnce(created())
    const setup = client(opened, true)
    await expect(
      sendExportToSpiris(setup.client, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('SPIRIS_OUTCOME_UNKNOWN')
    expect(http).toHaveBeenCalledTimes(2)
  })
  it('sends the recorded lines and records the voucher id and number', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('5561234567'))
      .mockResolvedValueOnce(created())
    const { client: c, calls } = client()
    const result = await sendExportToSpiris(
      c,
      tenant,
      exportId,
      requestId,
      env,
      http,
    )
    expect(result.status).toBe('sent')
    expect(result.voucherNumber).toBe('A42')
    const post = http.mock.calls[1]
    expect(String(post[0])).toBe(
      'https://eaccountingapi.vismaonline.com/v2/vouchers',
    )
    const sent = JSON.parse(String((post[1] as RequestInit).body))
    expect(sent.VoucherDate).toBe('2026-09-10')
    expect(sent.VoucherText).toBe('Dagsavslut 2026-09-10 v1')
    expect(sent.Rows).toHaveLength(3)
    const done = calls.find((x) => x.fn === 'complete_spiris_send')!
    expect(done.args.p_status).toBe('sent')
    expect(done.args.p_voucher_id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6')
    expect(done.args.p_voucher_number).toBe('A42')
  })
  it('refuses when another company answers and records the failure without posting', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('5569999999'))
    const { client: c, calls } = client()
    await expect(
      sendExportToSpiris(c, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('SPIRIS_WRONG_COMPANY')
    expect(http).toHaveBeenCalledTimes(1)
    const done = calls.find((x) => x.fn === 'complete_spiris_send')!
    expect(done.args.p_status).toBe('failed')
    expect(done.args.p_error).toBe('SPIRIS_PREFLIGHT_FAILED')
  })
  it('holds any failed POST without persisting its provider body', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('5561234567'))
      .mockResolvedValueOnce(
        json({ DeveloperErrorMessage: 'Fiscal year is closed' }, 400),
      )
    const { client: c, calls } = client()
    await expect(
      sendExportToSpiris(c, tenant, exportId, requestId, env, http),
    ).rejects.toThrow('SPIRIS_OUTCOME_UNKNOWN')
    const done = calls.find((x) => x.fn === 'complete_spiris_send')!
    expect(done.args.p_error).toBe('SPIRIS_OUTCOME_UNKNOWN')
    expect(done.args.p_detail).toBe('')
  })
  it('returns the recorded state on replay without contacting the provider', async () => {
    const http = vi.fn<typeof fetch>()
    const { client: c } = client({
      ...opened,
      status: 'sent',
      voucherNumber: 'A42',
    })
    const result = await sendExportToSpiris(
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
