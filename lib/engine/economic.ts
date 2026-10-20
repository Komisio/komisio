import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  accountNumber,
  createDrafts,
  draftBody,
  economicIssue,
  EconomicError,
  exportLine,
  grantUrl,
  readAgreement,
  readCatalogue,
  validateMapping,
  vatCode,
} from '../../extensions/economic/api'
import {
  credentialKeyConfigured,
  open,
  seal,
  sealedBox,
  signState,
  verifyState,
} from '../platform/credentials'
import { accountingKeys } from './accounting'
import { readStoreCurrency } from './money'

const PURPOSE = 'economic-connection'
export const ECONOMIC_STATE_COOKIE = 'komisio-economic-state'
type Environment = Record<string, string | undefined>
const integer = z.number().int().positive().max(2147483647)
export const economicMapBody = z
  .record(
    z.string(),
    z.union([
      z.strictObject({
        account: accountNumber,
        side: z.enum(['debit', 'credit']),
        vatCode,
      }),
      z.strictObject({ excludeReason: z.string().trim().min(1).max(500) }),
    ]),
  )
  .refine((map) =>
    Object.entries(map).every(
      ([key, value]) =>
        (accountingKeys as readonly string[]).includes(key) &&
        !(key.startsWith('mode:consignment_fee') && 'excludeReason' in value),
    ),
  )
export type EconomicMapBody = z.infer<typeof economicMapBody>
export const economicMap = z.object({
  id: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  map: economicMapBody,
  agreementNumber: integer.nullable(),
  journalNumber: integer.nullable(),
})
export const economicStatus = z.object({
  connected: z.boolean(),
  agreementNumber: integer.nullable(),
  companyName: z.string().nullable(),
  organisationNumber: z.string().nullable(),
  connectedAt: z.string().nullable(),
  events: z
    .array(
      z.object({
        kind: z.enum(['connected', 'checked', 'refused', 'disconnected']),
        agreementNumber: integer.nullable(),
        reason: z.string(),
        occurredAt: z.string(),
      }),
    )
    .max(20),
})
export const economicPreview = z.object({
  dayCloseId: z.uuid(),
  closeDate: z.iso.date(),
  closeVersion: integer,
  mapId: z.uuid().nullable(),
  mapVersion: z.number().int().nonnegative(),
  exportId: z.uuid().nullable(),
  agreementNumber: integer.nullable(),
  journalNumber: integer.nullable(),
  lines: z.array(exportLine),
  excluded: z.record(
    z.string(),
    z.object({ amountOre: z.number().int(), reason: z.string() }),
  ),
  unmapped: z.array(z.string()),
  debitOre: z.number().int(),
  creditOre: z.number().int(),
  balanced: z.boolean(),
})
export const economicSend = z.object({
  sendId: z.uuid(),
  exportId: z.uuid(),
  status: z.enum(['pending', 'sent', 'failed']),
  agreementNumber: integer,
  journalNumber: integer,
  voucherNumber: z.number().int().nullable(),
  errorCode: z.string(),
  reason: z.string(),
  retryAfter: z.string().nullable(),
  closeDate: z.iso.date(),
  closeVersion: integer,
  lines: z.array(exportLine),
  createdAt: z.string(),
  dispatchAllowed: z.boolean(),
})
export type EconomicSend = z.infer<typeof economicSend>

export const economicErrors = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'TENANT_CHANGED',
  'REQUEST_CONFLICT',
  'CREDENTIAL_KEY_MISSING',
  'CREDENTIAL_UNREADABLE',
  'MAP_CHANGED',
  'ACCOUNTING_MAP_REQUIRED',
  'DAY_CLOSE_NOT_FOUND',
  'EXPORT_NOT_FOUND',
  'VOUCHER_UNBALANCED',
  'SEND_NOT_FOUND',
  'SEND_NOT_PENDING',
  'ECONOMIC_NOT_CONFIGURED',
  'ECONOMIC_NOT_CONNECTED',
  'ECONOMIC_STATE_INVALID',
  'ECONOMIC_WRONG_AGREEMENT',
  'ECONOMIC_CURRENCY_UNSUPPORTED',
  'ECONOMIC_AUTH_REQUIRED',
  'ECONOMIC_ACCESS_DENIED',
  'ECONOMIC_RATE_LIMITED',
  'ECONOMIC_READ_FAILED',
  'ECONOMIC_CONNECTION_FAILED',
  'ECONOMIC_CATALOGUE_TOO_LARGE',
  'ECONOMIC_JOURNAL_INVALID',
  'ECONOMIC_ACCOUNT_INVALID',
  'ECONOMIC_ZERO_VAT_REQUIRED',
  'ECONOMIC_MAP_INCOMPLETE',
  'ECONOMIC_ALREADY_SENT',
  'ECONOMIC_SEND_IN_PROGRESS',
  'ECONOMIC_OUTCOME_UNKNOWN',
  'ECONOMIC_PREFLIGHT_FAILED',
  'ECONOMIC_UNVERIFIED_ENTRIES',
  'ECONOMIC_MULTIPLE_VOUCHERS',
  'REQUEST_FAILED',
] as const
export function economicErrorCode(error: unknown) {
  if (error instanceof z.ZodError) return 'INVALID_INPUT'
  return (
    economicErrors.find(
      (code) => error instanceof Error && error.message === code,
    ) ?? 'REQUEST_FAILED'
  )
}
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.rpc(name, args)
  if (result.error) throw new Error(result.error.message)
  return result.data
}
async function requireOwner(client: SupabaseClient, tenant: string) {
  z.uuid().parse(tenant)
  const role = await client.rpc('tenant_role', { p_tenant: tenant })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
}
function ready(source: Environment) {
  if (economicIssue(source)) throw new Error('ECONOMIC_NOT_CONFIGURED')
  if (!credentialKeyConfigured(source))
    throw new Error('CREDENTIAL_KEY_MISSING')
}
export async function readEconomicStatus(
  client: SupabaseClient,
  tenant: string,
) {
  const result = await client.rpc('economic_connection_status', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('FORBIDDEN')
  return economicStatus.parse(result.data)
}
export async function readEconomicMap(client: SupabaseClient, tenant: string) {
  return economicMap.parse(
    await rpc(client, 'current_economic_map', {
      p_tenant: z.uuid().parse(tenant),
    }),
  )
}
export async function previewEconomicVoucher(
  client: SupabaseClient,
  tenant: string,
  close: string,
) {
  return economicPreview.parse(
    await rpc(client, 'preview_economic_voucher', {
      p_tenant: z.uuid().parse(tenant),
      p_day_close: z.uuid().parse(close),
    }),
  )
}
export async function startEconomicConnection(
  client: SupabaseClient,
  tenant: string,
  callback: string,
  locale: string,
  source: Environment,
) {
  await requireOwner(client, tenant)
  ready(source)
  if ((await readStoreCurrency(client, tenant)) !== 'DKK')
    throw new Error('ECONOMIC_CURRENCY_UNSUPPORTED')
  const user = await client.auth.getUser()
  if (user.error || !user.data.user) throw new Error('AUTH_REQUIRED')
  const current = await readEconomicStatus(client, tenant)
  const state = signState(
    PURPOSE,
    {
      tenantId: tenant,
      userId: user.data.user.id,
      nonce: randomUUID(),
      agreementNumber: current?.agreementNumber?.toString() ?? '',
    },
    600,
    source,
  )
  return {
    state,
    url: grantUrl(
      source.ECONOMIC_APP_PUBLIC_TOKEN!.trim(),
      callback,
      state,
      locale,
    ),
  }
}
async function recordCheck(
  client: SupabaseClient,
  tenant: string,
  agreement: number | null,
  reason = '',
) {
  await rpc(client, 'record_economic_check', {
    p_tenant: tenant,
    p_kind: reason ? 'refused' : 'checked',
    p_agreement: agreement,
    p_reason: reason,
  })
}
export async function completeEconomicConnection(
  client: SupabaseClient,
  input: {
    tenantId: string
    state: string | null
    cookieState: string | null
    grant: string
  },
  source: Environment,
  http?: typeof fetch,
) {
  ready(source)
  const state = verifyState(PURPOSE, input.state, source)
  if (
    !state ||
    !input.cookieState ||
    input.cookieState !== input.state ||
    state.tenantId !== input.tenantId
  )
    throw new Error('ECONOMIC_STATE_INVALID')
  const tenant = z.uuid().parse(state.tenantId)
  await requireOwner(client, tenant)
  const user = await client.auth.getUser()
  if (user.error || user.data.user?.id !== state.userId)
    throw new Error('ECONOMIC_STATE_INVALID')
  const agreement = await readAgreement(
    { appSecret: source.ECONOMIC_APP_SECRET_TOKEN!.trim(), grant: input.grant },
    http,
  )
  const current = await readEconomicStatus(client, tenant)
  const pinned =
    current?.agreementNumber ??
    (state.agreementNumber ? Number(state.agreementNumber) : null)
  let refusal = ''
  if (pinned !== null && pinned !== agreement.agreementNumber)
    refusal = 'ECONOMIC_WRONG_AGREEMENT'
  else if (
    agreement.currency !== 'DKK' ||
    (await readStoreCurrency(client, tenant)) !== 'DKK'
  )
    refusal = 'ECONOMIC_CURRENCY_UNSUPPORTED'
  if (refusal) {
    await recordCheck(client, tenant, agreement.agreementNumber, refusal)
    throw new Error(refusal)
  }
  await rpc(client, 'store_economic_connection', {
    p_tenant: tenant,
    p_agreement: agreement.agreementNumber,
    p_name: agreement.name,
    p_organisation: agreement.organisationNumber,
    p_currency: agreement.currency,
    p_cipher: seal(`${PURPOSE}:${tenant}`, { grant: input.grant }, source),
  })
  return { tenantId: tenant }
}
async function credentials(
  client: SupabaseClient,
  tenant: string,
  source: Environment,
) {
  ready(source)
  const data = await rpc(client, 'read_economic_connection', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (!data) throw new Error('ECONOMIC_NOT_CONNECTED')
  const stored = z
    .object({ agreementNumber: integer, revision: z.uuid(), cipher: sealedBox })
    .parse(data)
  const secret = z
    .object({ grant: z.string().min(1).max(4096) })
    .parse(open(`${PURPOSE}:${tenant}`, stored.cipher, source))
  return {
    ...stored,
    credentials: {
      appSecret: source.ECONOMIC_APP_SECRET_TOKEN!.trim(),
      grant: secret.grant,
    },
  }
}
async function verifiedCredentials(
  client: SupabaseClient,
  tenant: string,
  source: Environment,
  http?: typeof fetch,
) {
  const stored = await credentials(client, tenant, source)
  const agreement = await readAgreement(stored.credentials, http)
  if (agreement.agreementNumber !== stored.agreementNumber)
    throw new Error('ECONOMIC_WRONG_AGREEMENT')
  if (
    agreement.currency !== 'DKK' ||
    (await readStoreCurrency(client, tenant)) !== 'DKK'
  )
    throw new Error('ECONOMIC_CURRENCY_UNSUPPORTED')
  return { ...stored, agreement }
}
export async function checkEconomicConnection(
  client: SupabaseClient,
  tenant: string,
  source: Environment,
  http?: typeof fetch,
) {
  await requireOwner(client, tenant)
  try {
    const verified = await verifiedCredentials(client, tenant, source, http)
    await recordCheck(client, tenant, verified.agreementNumber)
    return { checked: true }
  } catch (error) {
    const code = economicErrorCode(error)
    if (
      [
        'ECONOMIC_WRONG_AGREEMENT',
        'ECONOMIC_CURRENCY_UNSUPPORTED',
        'ECONOMIC_AUTH_REQUIRED',
        'ECONOMIC_ACCESS_DENIED',
        'ECONOMIC_READ_FAILED',
      ].includes(code)
    )
      await recordCheck(client, tenant, null, code)
    throw error
  }
}
export async function disconnectEconomic(
  client: SupabaseClient,
  tenant: string,
) {
  return {
    disconnected:
      (await rpc(client, 'disconnect_economic', {
        p_tenant: z.uuid().parse(tenant),
      })) === true,
  }
}
export async function economicCatalogue(
  client: SupabaseClient,
  tenant: string,
  source: Environment,
  http?: typeof fetch,
) {
  await requireOwner(client, tenant)
  const stored = await verifiedCredentials(client, tenant, source, http)
  return {
    agreementNumber: stored.agreementNumber,
    ...(await readCatalogue(stored.credentials, http)),
  }
}
export async function publishEconomicMap(
  client: SupabaseClient,
  input: {
    tenantId: string
    requestId: string
    expectedCurrentId: string | null
    agreementNumber: number
    journalNumber: number
    map: EconomicMapBody
  },
  source: Environment,
  http?: typeof fetch,
) {
  const value = z
    .strictObject({
      tenantId: z.uuid(),
      requestId: z.uuid(),
      expectedCurrentId: z.uuid().nullable(),
      agreementNumber: integer,
      journalNumber: integer,
      map: economicMapBody,
    })
    .parse(input)
  const catalogue = await economicCatalogue(
    client,
    value.tenantId,
    source,
    http,
  )
  if (catalogue.agreementNumber !== value.agreementNumber)
    throw new Error('ECONOMIC_WRONG_AGREEMENT')
  validateMapping(
    catalogue,
    value.journalNumber,
    Object.values(value.map).filter((v) => 'account' in v),
  )
  return {
    id: z.uuid().parse(
      await rpc(client, 'publish_economic_map', {
        p_tenant: value.tenantId,
        p_id: value.requestId,
        p_expected_current: value.expectedCurrentId,
        p_agreement: value.agreementNumber,
        p_journal: value.journalNumber,
        p_map: value.map,
      }),
    ),
  }
}
export async function exportEconomicDayClose(
  client: SupabaseClient,
  tenant: string,
  close: string,
  requestId: string,
) {
  return {
    id: z.uuid().parse(
      await rpc(client, 'export_economic_day_close', {
        p_tenant: z.uuid().parse(tenant),
        p_id: z.uuid().parse(requestId),
        p_day_close: z.uuid().parse(close),
      }),
    ),
  }
}
export async function sendEconomicExport(
  client: SupabaseClient,
  tenant: string,
  exportId: string,
  requestId: string,
  source: Environment,
  http?: typeof fetch,
) {
  const opened = economicSend.parse(
    await rpc(client, 'begin_economic_send', {
      p_tenant: z.uuid().parse(tenant),
      p_id: z.uuid().parse(requestId),
      p_export: z.uuid().parse(exportId),
    }),
  )
  if (opened.status !== 'pending') return opened
  if (!opened.dispatchAllowed) throw new Error('ECONOMIC_SEND_IN_PROGRESS')
  let attempted = false
  try {
    const verified = await verifiedCredentials(client, tenant, source, http)
    if (verified.agreementNumber !== opened.agreementNumber)
      throw new Error('ECONOMIC_WRONG_AGREEMENT')
    const catalogue = await readCatalogue(verified.credentials, http)
    validateMapping(catalogue, opened.journalNumber, opened.lines)
    const body = draftBody({
      journalNumber: opened.journalNumber,
      date: opened.closeDate,
      description: `Dagsafslutning ${opened.closeDate} v${opened.closeVersion} K-${opened.sendId}`,
      lines: opened.lines,
    })
    // A disconnect/reconnect during preflight must not dispatch the earlier grant.
    const latest = await credentials(client, tenant, source)
    if (latest.revision !== verified.revision)
      throw new Error('ECONOMIC_WRONG_AGREEMENT')
    const created = await createDrafts(
      verified.credentials,
      body,
      opened.sendId,
      () => {
        attempted = true
      },
      http,
    )
    return economicSend.parse(
      await rpc(client, 'complete_economic_send', {
        p_tenant: tenant,
        p_id: opened.sendId,
        p_status: 'sent',
        p_number: created.voucherNumber,
        p_error: '',
        p_reason: '',
        p_retry_seconds: null,
      }),
    )
  } catch (error) {
    const outcome = attempted
      ? 'ECONOMIC_OUTCOME_UNKNOWN'
      : 'ECONOMIC_PREFLIGHT_FAILED'
    try {
      return economicSend.parse(
        await rpc(client, 'complete_economic_send', {
          p_tenant: tenant,
          p_id: opened.sendId,
          p_status: 'failed',
          p_number: null,
          p_error: outcome,
          p_reason: economicErrorCode(error),
          p_retry_seconds:
            error instanceof EconomicError
              ? (error.retrySeconds ?? null)
              : null,
        }),
      )
    } catch {
      // Lost completion must retain the original pending claim, never release it.
      throw new Error(
        attempted ? 'ECONOMIC_OUTCOME_UNKNOWN' : 'ECONOMIC_SEND_IN_PROGRESS',
      )
    }
  }
}
export async function confirmEconomicSend(
  client: SupabaseClient,
  tenant: string,
  send: string,
  journal: number,
  voucher: number,
  evidence: string,
) {
  return economicSend.parse(
    await rpc(client, 'confirm_economic_send', {
      p_tenant: z.uuid().parse(tenant),
      p_send: z.uuid().parse(send),
      p_journal: integer.parse(journal),
      p_voucher: z.number().int().min(0).max(999999999).parse(voucher),
      p_evidence: z.string().trim().min(1).max(500).parse(evidence),
    }),
  )
}
const exportRow = z.object({
  id: z.uuid(),
  day_close_id: z.uuid(),
  map_id: z.uuid(),
  agreement_number: integer,
  journal_number: integer,
  voucher: z.array(exportLine),
  excluded: z.record(
    z.string(),
    z.object({ amountOre: z.number().int(), reason: z.string() }),
  ),
  debit_ore: z.number().int(),
  credit_ore: z.number().int(),
  created_at: z.string(),
  day_closes: z.object({ close_date: z.iso.date(), version: integer }),
  economic_maps: z.object({ version: integer }),
  send: economicSend.nullable(),
})
export async function readEconomicExports(
  client: SupabaseClient,
  tenant: string,
  selected?: string,
) {
  return z.array(exportRow).parse(
    await rpc(client, 'economic_export_page', {
      p_tenant: z.uuid().parse(tenant),
      p_export: selected ? z.uuid().parse(selected) : null,
    }),
  )
}
