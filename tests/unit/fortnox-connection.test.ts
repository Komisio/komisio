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
  fortnoxAccessToken,
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
    if (fn === 'refresh_fortnox_tokens')
      return { data: { status: 'refreshed', revision: '2' }, error: null }
    return { data: true, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, calls }
}

describe('revision-bound refresh', () => {
  const row = (revision: string | undefined, expired = true) => ({
    revision,
    databaseNumber: '123456',
    companyName: 'Komisio Test',
    organisationNumber: '',
    scope: 'bookkeeping',
    expiresAt: new Date(Date.now() + (expired ? -1000 : 3600000)).toISOString(),
    cipher: seal(
      'fortnox-connection',
      {
        accessToken: `access-${revision}`,
        refreshToken: `refresh-${revision}`,
      },
      env,
    ),
  })
  function fixture(connections: unknown[], outcomes: unknown[]) {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'tenant_role') return { data: 'owner', error: null }
      if (name === 'read_fortnox_connection')
        return { data: connections.shift(), error: null }
      if (name === 'refresh_fortnox_tokens') {
        const outcome = outcomes.shift()
        if (outcome instanceof Error) throw outcome
        return outcome
      }
      if (name === 'store_fortnox_connection')
        throw new Error('UNSAFE_FALLBACK')
      return { data: null, error: null }
    })
    return { rpc, client: { rpc } as unknown as SupabaseClient }
  }
  it('rereads once after conflict and uses the new valid connection token', async () => {
    const fixtureData = fixture(
      [row('9007199254740993'), row('9007199254740994', false)],
      [{ data: { error: 'FORTNOX_CONNECTION_CHANGED' }, error: null }],
    )
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens())
    const result = await fortnoxAccessToken(
      fixtureData.client,
      tenant,
      env,
      http,
    )
    expect(result.accessToken).toBe('access-9007199254740994')
    expect(http).toHaveBeenCalledTimes(1)
    expect(fixtureData.rpc).toHaveBeenCalledWith(
      'refresh_fortnox_tokens',
      expect.objectContaining({ p_revision: '9007199254740993' }),
    )
    expect(
      fixtureData.rpc.mock.calls.filter(
        ([name]) => name === 'read_fortnox_connection',
      ),
    ).toHaveLength(2)
  })
  it('refreshes the reread revision but never loops on another conflict', async () => {
    const conflict = {
      data: { error: 'FORTNOX_CONNECTION_CHANGED' },
      error: null,
    }
    const fixtureData = fixture([row('1'), row('2')], [conflict, conflict])
    const http = vi.fn<typeof fetch>().mockImplementation(async () => tokens())
    await expect(
      fortnoxAccessToken(fixtureData.client, tenant, env, http),
    ).rejects.toThrow('FORTNOX_CONNECTION_CHANGED')
    expect(http).toHaveBeenCalledTimes(2)
    expect(fixtureData.rpc).toHaveBeenCalledWith(
      'refresh_fortnox_tokens',
      expect.objectContaining({ p_revision: '2' }),
    )
    expect(
      fixtureData.rpc.mock.calls.filter(
        ([name]) => name === 'read_fortnox_connection',
      ),
    ).toHaveLength(2)
  })
  it.each([
    { error: { message: 'synthetic secret failure' }, data: null },
    new Error('synthetic secret failure'),
    { error: null, data: true },
  ])(
    'fails closed without returning or retrying rotated tokens when save fails: %j',
    async (outcome) => {
      const fixtureData = fixture([row('1')], [outcome])
      const http = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens())
      await expect(
        fortnoxAccessToken(fixtureData.client, tenant, env, http),
      ).rejects.toThrow('FORTNOX_REFRESH_SAVE_FAILED')
      expect(http).toHaveBeenCalledTimes(1)
      expect(fixtureData.rpc).toHaveBeenCalledWith('record_fortnox_check', {
        p_tenant: tenant,
        p_kind: 'refused',
        p_detail: { reason: 'save_failed', revision: '1' },
      })
      expect(
        fixtureData.rpc.mock.calls.filter(
          ([name]) => name === 'read_fortnox_connection',
        ),
      ).toHaveLength(1)
      expect(
        fixtureData.rpc.mock.calls.some(
          ([name]) => name === 'store_fortnox_connection',
        ),
      ).toBe(false)
    },
  )
  it('can refresh the new revision after one conflict', async () => {
    const fixtureData = fixture(
      [row('1'), row('2')],
      [
        { data: { error: 'FORTNOX_CONNECTION_CHANGED' }, error: null },
        { data: { status: 'refreshed', revision: '3' }, error: null },
      ],
    )
    const http = vi.fn<typeof fetch>().mockImplementation(async () => tokens())
    const result = await fortnoxAccessToken(
      fixtureData.client,
      tenant,
      env,
      http,
    )
    expect(result.row.revision).toBe('3')
    expect(result.accessToken).toBe('synthetic-access')
    expect(http).toHaveBeenCalledTimes(2)
    expect(
      fixtureData.rpc.mock.calls.some(
        ([name]) => name === 'store_fortnox_connection',
      ),
    ).toBe(false)
  })
  it('stops if the conflict reread finds a disconnected store', async () => {
    const fixtureData = fixture(
      [row('1'), null],
      [{ data: { error: 'FORTNOX_CONNECTION_CHANGED' }, error: null }],
    )
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens())
    await expect(
      fortnoxAccessToken(fixtureData.client, tenant, env, http),
    ).rejects.toThrow('FORTNOX_NOT_CONNECTED')
    expect(http).toHaveBeenCalledTimes(1)
  })
  it('does not rotate a token before the revision migration is present', async () => {
    const fixtureData = fixture([row(undefined)], [])
    const http = vi.fn<typeof fetch>()
    await expect(
      fortnoxAccessToken(fixtureData.client, tenant, env, http),
    ).rejects.toThrow('FORTNOX_REFRESH_UNAVAILABLE')
    expect(http).not.toHaveBeenCalled()
  })
  it('records only the allowlisted invalid_grant reason and does not save', async () => {
    const fixtureData = fixture([row('1')], [])
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json(
        {
          error: 'invalid_grant',
          error_description: 'synthetic provider secret',
        },
        400,
      ),
    )
    await expect(
      fortnoxAccessToken(fixtureData.client, tenant, env, http),
    ).rejects.toThrow('FORTNOX_REFRESH_INVALID_GRANT')
    expect(fixtureData.rpc).toHaveBeenCalledWith('record_fortnox_check', {
      p_tenant: tenant,
      p_kind: 'refused',
      p_detail: { reason: 'invalid_grant', revision: '1' },
    })
    expect(
      fixtureData.rpc.mock.calls.some(
        ([name]) => name === 'refresh_fortnox_tokens',
      ),
    ).toBe(false)
    expect(JSON.stringify(fixtureData.rpc.mock.calls)).not.toContain(
      'synthetic provider secret',
    )
  })
})

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
      revision: '1',
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
    expect(calls.filter((x) => x.fn === 'refresh_fortnox_tokens')).toHaveLength(
      1,
    )
    expect(calls.some((entry) => entry.fn === 'store_fortnox_connection')).toBe(
      false,
    )
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
