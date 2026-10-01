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
  companyKey,
  exchangeCode,
  readCompanySettings,
  spirisEnvironment,
  spirisIssue,
  verifyCompany,
} from '../../extensions/spiris/auth'
import {
  checkSpirisConnection,
  completeSpirisConnection,
  spirisAccessToken,
  startSpirisConnection,
} from '../../lib/engine/spiris-connection'

const tenant = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SPIRIS_CLIENT_ID: 'synthetic-client',
  SPIRIS_CLIENT_SECRET: 'synthetic-secret',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const company = (
  Name: string,
  CorporateIdentityNumber: string | null = '556123-4567',
  CurrencyCode = 'SEK',
) => json({ Name, CorporateIdentityNumber, CurrencyCode, Email: 'x@y.test' })
const tokens = () =>
  json({
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    expires_in: 3600,
    scope: 'ea:api ea:accounting offline_access',
  })

describe('spiris adapter', () => {
  it('reports configuration issues and defaults the hosts to production', () => {
    expect(spirisIssue(spirisEnvironment({}))).toBe('connectionClientMissing')
    expect(
      spirisIssue(spirisEnvironment({ ...env, SPIRIS_CLIENT_SECRET: '' })),
    ).toBe('connectionSecretMissing')
    expect(spirisIssue(spirisEnvironment(env))).toBeNull()
    const defaults = spirisEnvironment(env)
    expect(defaults.SPIRIS_IDENTITY_URL).toBe(
      'https://identity.vismaonline.com',
    )
    expect(defaults.SPIRIS_API_URL).toBe(
      'https://eaccountingapi.vismaonline.com/v2',
    )
    const sandbox = spirisEnvironment({
      ...env,
      SPIRIS_IDENTITY_URL: 'https://identity-sandbox.test.vismaonline.com/',
      SPIRIS_API_URL: 'http://insecure.example',
    })
    expect(sandbox.SPIRIS_IDENTITY_URL).toBe(
      'https://identity-sandbox.test.vismaonline.com',
    )
    expect(sandbox.SPIRIS_API_URL).toBe(
      'https://eaccountingapi.vismaonline.com/v2',
    )
  })
  it('builds the authorisation url with the accounting scopes', () => {
    const url = new URL(
      authorizeUrl(spirisEnvironment(env), 'https://x/cb', 'st'),
    )
    expect(url.origin + url.pathname).toBe(
      'https://identity.vismaonline.com/connect/authorize',
    )
    expect(url.searchParams.get('scope')).toBe(
      'ea:api ea:accounting offline_access',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st')
  })
  it('exchanges the code with basic auth and reads the company settings', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Komisio Test'))
    const set = await exchangeCode(
      spirisEnvironment(env),
      'code',
      'https://x/cb',
      http,
    )
    expect(set.refresh_token).toBe('synthetic-refresh')
    expect(String(http.mock.calls[0][0])).toBe(
      'https://identity.vismaonline.com/connect/token',
    )
    const init = http.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /,
    )
    expect(String(init.body)).toContain('grant_type=authorization_code')
    const info = await readCompanySettings(
      spirisEnvironment(env),
      set.access_token,
      http,
    )
    expect(String(http.mock.calls[1][0])).toBe(
      'https://eaccountingapi.vismaonline.com/v2/companysettings',
    )
    expect(info.CorporateIdentityNumber).toBe('556123-4567')
    expect(companyKey(info)).toBe('5561234567')
  })
  it('falls back to the normalised name as the key when there is no corporate number', () => {
    expect(
      companyKey({
        Name: 'Komisio Test',
        CorporateIdentityNumber: '',
        CurrencyCode: 'SEK',
      }),
    ).toBe('name:komisio test')
  })
  it('pins the company name and, once connected, the company key', () => {
    const test = {
      Name: 'komisio test',
      CorporateIdentityNumber: '5561234567',
      CurrencyCode: 'SEK',
    }
    expect(verifyCompany({ companyName: 'Komisio Test' }, test)).toEqual({
      pinnedKey: false,
    })
    expect(() =>
      verifyCompany(
        { companyName: 'Komisio Test' },
        { ...test, Name: 'Inority AB' },
      ),
    ).toThrow('SPIRIS_WRONG_COMPANY')
    expect(() =>
      verifyCompany({ companyName: 'Komisio Test', companyKey: '999' }, test),
    ).toThrow('SPIRIS_WRONG_COMPANY')
    expect(
      verifyCompany(
        { companyName: 'Komisio Test', companyKey: '5561234567' },
        test,
      ),
    ).toEqual({ pinnedKey: true })
  })
})

function client(
  role: string,
  rows: Record<string, unknown> = {},
  status: Record<string, unknown> | null = null,
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    if (fn === 'tenant_role') return { data: role, error: null }
    if (fn === 'spiris_connection_status')
      return {
        data: status ?? {
          connected: false,
          companyKey: null,
          companyName: null,
          organisationNumber: null,
          currencyCode: null,
          scope: null,
          connectedAt: null,
          refreshedAt: null,
          events: [],
        },
        error: null,
      }
    if (fn === 'read_spiris_connection')
      return { data: rows.connection ?? null, error: null }
    if (fn === 'refresh_spiris_tokens')
      return { data: { status: 'refreshed', revision: '2' }, error: null }
    return { data: true, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, calls }
}

describe('spiris connection engine', () => {
  it('binds the typed company name to signed state and keeps the key once connected', async () => {
    const fresh = client('owner')
    const started = await startSpirisConnection(
      fresh.client,
      tenant,
      'https://x/cb',
      env,
      'My store',
    )
    expect(verifyState('spiris-connection', started.state, env)).toEqual({
      tenantId: tenant,
      companyName: 'My store',
      companyKey: '',
    })
    const connected = client(
      'admin',
      {},
      {
        connected: true,
        companyKey: '5561234567',
        companyName: 'Komisio Test',
        organisationNumber: '556123-4567',
        currencyCode: 'SEK',
        scope: '',
        connectedAt: null,
        refreshedAt: null,
        events: [],
      },
    )
    const again = await startSpirisConnection(
      connected.client,
      tenant,
      'https://x/cb',
      env,
    )
    expect(verifyState('spiris-connection', again.state, env)).toEqual({
      tenantId: tenant,
      companyName: 'Komisio Test',
      companyKey: '5561234567',
    })
    await expect(
      startSpirisConnection(
        client('staff').client,
        tenant,
        'https://x/cb',
        env,
        'x',
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
  it('refuses another company and records the refusal without a token', async () => {
    const state = signState(
      'spiris-connection',
      { tenantId: tenant, companyName: 'Komisio Test' },
      60,
      env,
    )
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Inority AB'))
    const { client: c, calls } = client('owner')
    await expect(
      completeSpirisConnection(
        c,
        { code: 'code', state, cookieState: state },
        'https://x/cb',
        env,
        http,
      ),
    ).rejects.toThrow('SPIRIS_WRONG_COMPANY')
    const refusal = calls.find((x) => x.fn === 'record_spiris_check')
    expect(refusal?.args.p_kind).toBe('refused')
    expect(JSON.stringify(refusal?.args)).not.toContain('synthetic-access')
    expect(calls.some((x) => x.fn === 'store_spiris_connection')).toBe(false)
  })
  it('stores the sealed tokens, key and currency for the expected company', async () => {
    const state = signState(
      'spiris-connection',
      { tenantId: tenant, companyName: 'Komisio Test', companyKey: '' },
      60,
      env,
    )
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(company('Komisio Test', '556123-4567', 'sek'))
    const { client: c, calls } = client('admin')
    const result = await completeSpirisConnection(
      c,
      { code: 'code', state, cookieState: state },
      'https://x/cb',
      env,
      http,
    )
    expect(result).toEqual({
      tenantId: tenant,
      companyName: 'Komisio Test',
      companyKey: '5561234567',
      currencyCode: 'SEK',
    })
    const store = calls.find((x) => x.fn === 'store_spiris_connection')!
    expect(store.args.p_company_key).toBe('5561234567')
    expect(store.args.p_currency_code).toBe('SEK')
    expect(JSON.stringify(store.args)).not.toContain('synthetic-access')
    expect(open('spiris-connection', store.args.p_cipher, env)).toEqual({
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
    })
  })
  it('rejects a state that does not match the cookie, and staff', async () => {
    const state = signState(
      'spiris-connection',
      { tenantId: tenant, companyName: 'Komisio Test' },
      60,
      env,
    )
    await expect(
      completeSpirisConnection(
        client('owner').client,
        { code: 'code', state, cookieState: 'other' },
        'https://x/cb',
        env,
      ),
    ).rejects.toThrow('SPIRIS_STATE_INVALID')
    await expect(
      completeSpirisConnection(
        client('staff').client,
        { code: 'code', state, cookieState: state },
        'https://x/cb',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
})

describe('revision-bound refresh', () => {
  const row = (revision: string, expired = true) => ({
    revision,
    companyKey: '5561234567',
    companyName: 'Komisio Test',
    organisationNumber: '556123-4567',
    currencyCode: 'SEK',
    scope: 'ea:api',
    expiresAt: new Date(Date.now() + (expired ? -1000 : 3600000)).toISOString(),
    cipher: seal(
      'spiris-connection',
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
      if (name === 'read_spiris_connection')
        return { data: connections.shift(), error: null }
      if (name === 'refresh_spiris_tokens') {
        const outcome = outcomes.shift()
        if (outcome instanceof Error) throw outcome
        return outcome
      }
      if (name === 'store_spiris_connection') throw new Error('UNSAFE_FALLBACK')
      return { data: null, error: null }
    })
    return { rpc, client: { rpc } as unknown as SupabaseClient }
  }
  it('returns a token that is still valid without contacting Visma', async () => {
    const f = fixture([row('1', false)], [])
    const http = vi.fn<typeof fetch>()
    const result = await spirisAccessToken(f.client, tenant, env, http)
    expect(result.accessToken).toBe('access-1')
    expect(http).not.toHaveBeenCalled()
  })
  it('rereads once after a conflict and uses the new valid token', async () => {
    const f = fixture(
      [row('9007199254740993'), row('9007199254740994', false)],
      [{ data: { error: 'SPIRIS_CONNECTION_CHANGED' }, error: null }],
    )
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens())
    const result = await spirisAccessToken(f.client, tenant, env, http)
    expect(result.accessToken).toBe('access-9007199254740994')
    expect(http).toHaveBeenCalledTimes(1)
    expect(f.rpc).toHaveBeenCalledWith(
      'refresh_spiris_tokens',
      expect.objectContaining({ p_revision: '9007199254740993' }),
    )
  })
  it('never loops on a second conflict', async () => {
    const conflict = {
      data: { error: 'SPIRIS_CONNECTION_CHANGED' },
      error: null,
    }
    const f = fixture([row('1'), row('2')], [conflict, conflict])
    const http = vi.fn<typeof fetch>().mockImplementation(async () => tokens())
    await expect(
      spirisAccessToken(f.client, tenant, env, http),
    ).rejects.toThrow('SPIRIS_CONNECTION_CHANGED')
    expect(http).toHaveBeenCalledTimes(2)
  })
  it('fails closed and records the refusal when the save fails', async () => {
    const f = fixture([row('1')], [{ error: { message: 'boom' }, data: null }])
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens())
    await expect(
      spirisAccessToken(f.client, tenant, env, http),
    ).rejects.toThrow('SPIRIS_REFRESH_SAVE_FAILED')
    expect(f.rpc).toHaveBeenCalledWith('record_spiris_check', {
      p_tenant: tenant,
      p_kind: 'refused',
      p_detail: { reason: 'save_failed', revision: '1' },
    })
    expect(
      f.rpc.mock.calls.some(([name]) => name === 'store_spiris_connection'),
    ).toBe(false)
  })
  it('records only the allowlisted invalid_grant reason without the provider text', async () => {
    const f = fixture([row('1')], [])
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
      spirisAccessToken(f.client, tenant, env, http),
    ).rejects.toThrow('SPIRIS_REFRESH_INVALID_GRANT')
    expect(f.rpc).toHaveBeenCalledWith('record_spiris_check', {
      p_tenant: tenant,
      p_kind: 'refused',
      p_detail: { reason: 'invalid_grant', revision: '1' },
    })
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(
      'synthetic provider secret',
    )
  })
  it('checks the connected company against the stored pins', async () => {
    const good = client('owner', { connection: row('1', false) })
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(company('Komisio Test'))
    const result = await checkSpirisConnection(good.client, tenant, env, http)
    expect(result.companyKey).toBe('5561234567')
    expect(result.currencyCode).toBe('SEK')
    expect(
      good.calls.find((x) => x.fn === 'record_spiris_check')?.args.p_kind,
    ).toBe('checked')
    const wrong = client('owner', { connection: row('1', false) })
    await expect(
      checkSpirisConnection(
        wrong.client,
        tenant,
        env,
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(company('Komisio Test', '5569999999')),
      ),
    ).rejects.toThrow('SPIRIS_WRONG_COMPANY')
    expect(
      wrong.calls.find((x) => x.fn === 'record_spiris_check')?.args.p_kind,
    ).toBe('refused')
  })
})
