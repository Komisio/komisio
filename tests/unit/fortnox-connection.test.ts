import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  open,
  seal,
  signState,
  verifyState,
} from '../../lib/platform/credentials'
import {
  authorizeUrl,
  exchangeCode,
  fortnoxEnvironment,
  fortnoxIssue,
  readCompanyInformation,
  verifyCompany,
} from '../../extensions/fortnox/auth'
import {
  checkFortnoxConnection,
  completeFortnoxConnection,
} from '../../lib/engine/fortnox-connection'

const tenant = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  FORTNOX_CLIENT_ID: 'synthetic-client',
  FORTNOX_CLIENT_SECRET: 'synthetic-secret',
  FORTNOX_PILOT_TENANT_ID: tenant,
  FORTNOX_EXPECTED_COMPANY_NAME: 'Komisio Test',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const company = (CompanyName: string, DatabaseNumber = 123456) =>
  json({
    CompanyInformation: {
      CompanyName,
      OrganizationNumber: '556123-4567',
      DatabaseNumber,
    },
  })
const tokens = () =>
  json({
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    expires_in: 3600,
    scope: 'companyinformation bookkeeping',
  })

describe('credentials', () => {
  it('seals and opens with the purpose bound', () => {
    const box = seal('p', { accessToken: 'a' }, env)
    expect(open('p', box, env)).toEqual({ accessToken: 'a' })
    expect(() => open('other', box, env)).toThrow('CREDENTIAL_UNREADABLE')
    expect(() =>
      open('p', box, { KOMISIO_CREDENTIAL_KEY: 'cd'.repeat(32) }),
    ).toThrow('CREDENTIAL_UNREADABLE')
    expect(() => seal('p', {}, {})).toThrow('CREDENTIAL_KEY_MISSING')
  })
  it('signs and verifies expiring state', () => {
    const state = signState('s', { tenantId: tenant }, 60, env)
    expect(verifyState('s', state, env)).toEqual({ tenantId: tenant })
    expect(verifyState('t', state, env)).toBeNull()
    expect(verifyState('s', `${state}x`, env)).toBeNull()
    expect(
      verifyState('s', signState('s', { a: 'b' }, -1, env), env),
    ).toBeNull()
  })
})

describe('fortnox adapter', () => {
  it('reports configuration issues in order', () => {
    expect(fortnoxIssue(tenant, fortnoxEnvironment({}))).toBe(
      'connectionTenantMissing',
    )
    expect(
      fortnoxIssue(
        '20000000-0000-4000-8000-000000000002',
        fortnoxEnvironment(env),
      ),
    ).toBe('connectionUnavailable')
    expect(
      fortnoxIssue(
        tenant,
        fortnoxEnvironment({ ...env, FORTNOX_CLIENT_SECRET: '' }),
      ),
    ).toBe('connectionSecretMissing')
    expect(
      fortnoxIssue(
        tenant,
        fortnoxEnvironment({ ...env, FORTNOX_EXPECTED_COMPANY_NAME: '' }),
      ),
    ).toBe('connectionCompanyNameMissing')
    expect(fortnoxIssue(tenant, fortnoxEnvironment(env))).toBeNull()
  })
  it('builds the authorisation url with offline access', () => {
    const url = new URL(
      authorizeUrl(fortnoxEnvironment(env), 'https://x/cb', 'st'),
    )
    expect(url.origin + url.pathname).toBe(
      'https://apps.fortnox.se/oauth-v1/auth',
    )
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toBe('companyinformation bookkeeping')
    expect(url.searchParams.get('state')).toBe('st')
  })
  it('exchanges the code with basic auth and reads the company', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Komisio Test'))
    const set = await exchangeCode(
      fortnoxEnvironment(env),
      'code',
      'https://x/cb',
      http,
    )
    expect(set.refresh_token).toBe('synthetic-refresh')
    const init = http.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /,
    )
    expect(String(init.body)).toContain('grant_type=authorization_code')
    const info = await readCompanyInformation(set.access_token, http)
    expect(info.DatabaseNumber).toBe('123456')
  })
  it('pins the company name and, when set, the database number; never the org number', () => {
    const base = fortnoxEnvironment(env)
    const test = {
      CompanyName: 'komisio test',
      OrganizationNumber: '1',
      DatabaseNumber: '123456',
    }
    expect(verifyCompany(base, test)).toEqual({ pinnedDatabase: false })
    expect(() =>
      verifyCompany(base, { ...test, CompanyName: 'Inority AB' }),
    ).toThrow('FORTNOX_WRONG_COMPANY')
    const pinned = fortnoxEnvironment({
      ...env,
      FORTNOX_EXPECTED_DATABASE_NUMBER: '999',
    })
    expect(() => verifyCompany(pinned, test)).toThrow('FORTNOX_WRONG_COMPANY')
    expect(verifyCompany(pinned, { ...test, DatabaseNumber: '999' })).toEqual({
      pinnedDatabase: true,
    })
  })
})

function client(role: string, rows: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    if (fn === 'tenant_role') return { data: role, error: null }
    if (fn === 'read_fortnox_connection')
      return { data: rows.connection ?? null, error: null }
    return { data: true, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, calls }
}

describe('fortnox connection engine', () => {
  it('refuses the production company and records the refusal without a token', async () => {
    const state = signState('fortnox-connection', { tenantId: tenant }, 60, env)
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Inority AB', 1))
    const { client: c, calls } = client('owner')
    await expect(
      completeFortnoxConnection(
        c,
        { code: 'code', state, cookieState: state },
        'https://x/cb',
        env,
        http,
      ),
    ).rejects.toThrow('FORTNOX_WRONG_COMPANY')
    const refusal = calls.find((x) => x.fn === 'record_fortnox_check')
    expect(refusal?.args.p_kind).toBe('refused')
    expect(JSON.stringify(refusal?.args)).not.toContain('synthetic-access')
    expect(calls.some((x) => x.fn === 'store_fortnox_connection')).toBe(false)
  })
  it('stores the sealed tokens for the expected company', async () => {
    const state = signState('fortnox-connection', { tenantId: tenant }, 60, env)
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Komisio Test'))
    const { client: c, calls } = client('admin')
    const result = await completeFortnoxConnection(
      c,
      { code: 'code', state, cookieState: state },
      'https://x/cb',
      env,
      http,
    )
    expect(result).toEqual({
      tenantId: tenant,
      companyName: 'Komisio Test',
      databaseNumber: '123456',
    })
    const store = calls.find((x) => x.fn === 'store_fortnox_connection')!
    expect(store.args.p_database_number).toBe('123456')
    expect(JSON.stringify(store.args)).not.toContain('synthetic-access')
    expect(open('fortnox-connection', store.args.p_cipher, env)).toEqual({
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
    })
  })
  it('rejects a state that does not match the cookie, and staff', async () => {
    const state = signState('fortnox-connection', { tenantId: tenant }, 60, env)
    await expect(
      completeFortnoxConnection(
        client('owner').client,
        { code: 'code', state, cookieState: 'other' },
        'https://x/cb',
        env,
      ),
    ).rejects.toThrow('FORTNOX_STATE_INVALID')
    await expect(
      completeFortnoxConnection(
        client('staff').client,
        { code: 'code', state, cookieState: state },
        'https://x/cb',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
  it('checks a stored connection, refreshing an expired token', async () => {
    const cipher = seal(
      'fortnox-connection',
      { accessToken: 'old-access', refreshToken: 'old-refresh' },
      env,
    )
    const connection = {
      databaseNumber: '123456',
      companyName: 'Komisio Test',
      organisationNumber: '556123-4567',
      cipher,
      scope: 'bookkeeping',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Komisio Test'))
    const { client: c, calls } = client('owner', { connection })
    const result = await checkFortnoxConnection(c, tenant, env, http)
    expect(result.companyName).toBe('Komisio Test')
    expect(result.pinnedDatabase).toBe(false)
    expect(String((http.mock.calls[0][1] as RequestInit).body)).toContain(
      'refresh_token=old-refresh',
    )
    expect(
      calls.filter((x) => x.fn === 'store_fortnox_connection'),
    ).toHaveLength(1)
    expect(calls.at(-1)?.args.p_kind).toBe('checked')
  })
  it('refuses a check whose company moved to another database', async () => {
    const connection = {
      databaseNumber: '123456',
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
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('Komisio Test', 7))
    const { client: c, calls } = client('owner', { connection })
    await expect(checkFortnoxConnection(c, tenant, env, http)).rejects.toThrow(
      'FORTNOX_WRONG_COMPANY',
    )
    expect(calls.at(-1)?.args.p_kind).toBe('refused')
  })
})
