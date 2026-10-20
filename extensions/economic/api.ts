import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

const REST = 'https://restapi.e-conomic.com'
const JOURNALS = 'https://apis.e-conomic.com/journalsapi/v16.0.1'
const integer = z.number().int().positive().max(2147483647)
const token = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\s]+$/)
export const vatCode = z.string().regex(/^[A-Za-z0-9]{1,5}$/)
export const accountNumber = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .refine((value) => Number(value) <= 2147483647)
export type Credentials = { appSecret: string; grant: string }

export function economicIssue(source: Record<string, string | undefined>) {
  return token.safeParse(source.ECONOMIC_APP_SECRET_TOKEN?.trim()).success &&
    token.safeParse(source.ECONOMIC_APP_PUBLIC_TOKEN?.trim()).success
    ? null
    : 'ECONOMIC_NOT_CONFIGURED'
}

export function grantUrl(
  publicToken: string,
  callback: string,
  state: string,
  locale: string,
) {
  const redirect = new URL(callback)
  redirect.searchParams.set('state', state)
  const url = new URL(
    'https://secure.e-conomic.com/secure/api1/requestaccess.aspx',
  )
  url.searchParams.set('appPublicToken', token.parse(publicToken))
  url.searchParams.set('redirectUrl', redirect.toString())
  url.searchParams.set('locale', locale === 'dk' ? 'da-DK' : 'en-US')
  return url.toString()
}

export class EconomicError extends Error {
  constructor(
    code: string,
    readonly retrySeconds?: number,
  ) {
    super(code)
  }
}

function retrySeconds(value: string | null) {
  if (!value) return 60
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000)
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 60
}

async function request(
  credentials: Credentials,
  url: string,
  http: typeof fetch,
  body?: { entries: DraftInput[] },
  requestId?: string,
) {
  const headers: Record<string, string> = {
    'X-AppSecretToken': token.parse(credentials.appSecret),
    'X-AgreementGrantToken': token.parse(credentials.grant),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (requestId)
    headers['Idempotency-Key'] = `komisio-${z.uuid().parse(requestId)}`
  let response: Response
  try {
    response = await http(url, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: serializeDraftBody(body) } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new EconomicError('ECONOMIC_CONNECTION_FAILED')
  }
  if (response.status === 401) throw new EconomicError('ECONOMIC_AUTH_REQUIRED')
  if (response.status === 403) throw new EconomicError('ECONOMIC_ACCESS_DENIED')
  if (response.status === 429)
    throw new EconomicError(
      'ECONOMIC_RATE_LIMITED',
      retrySeconds(response.headers.get('retry-after')),
    )
  if (!response.ok) throw new EconomicError('ECONOMIC_READ_FAILED')
  try {
    return await boundedJson(response, 2 * 1024 * 1024)
  } catch {
    throw new EconomicError('ECONOMIC_READ_FAILED')
  }
}

const company = z.object({
  agreementNumber: integer,
  company: z.object({
    name: z.string().min(1).max(200),
    companyIdentificationNumber: z.string().max(40).optional(),
  }),
  settings: z.object({ baseCurrency: z.string().length(3) }),
})
export async function readAgreement(
  credentials: Credentials,
  http: typeof fetch = fetch,
) {
  const value = company.parse(await request(credentials, `${REST}/self`, http))
  return {
    agreementNumber: value.agreementNumber,
    name: value.company.name,
    organisationNumber: value.company.companyIdentificationNumber ?? '',
    currency: value.settings.baseCurrency,
  }
}

export const account = z.object({
  accountNumber: integer,
  name: z.string().max(200),
  accountType: z.string(),
  // REST explicitly omits false booleans.
  barred: z.boolean().optional().default(false),
  blockDirectEntries: z.boolean().optional().default(false),
  contraAccount: z.object({ accountNumber: integer }).nullable().optional(),
})
export const vatAccount = z.object({
  vatCode,
  name: z.string().max(200),
  ratePercentage: z.number(),
  barred: z.boolean().optional().default(false),
})
export const journal = z.object({
  number: integer,
  name: z.string().max(200),
  isStandingJournal: z.boolean(),
  allowedEntryType: z.number().int().nullable().optional(),
})
export type Catalogue = {
  accounts: z.infer<typeof account>[]
  vatAccounts: z.infer<typeof vatAccount>[]
  journals: z.infer<typeof journal>[]
}

async function collection<T>(
  credentials: Credentials,
  path: 'accounts' | 'vat-accounts',
  schema: z.ZodType<T>,
  http: typeof fetch,
) {
  const rows: T[] = []
  for (let page = 0; page < 20; page++) {
    const data = z
      .object({ collection: z.array(schema).max(1000) })
      .parse(
        await request(
          credentials,
          `${REST}/${path}?pagesize=1000&skippages=${page}`,
          http,
        ),
      )
    rows.push(...data.collection)
    if (data.collection.length < 1000) return rows
  }
  throw new EconomicError('ECONOMIC_CATALOGUE_TOO_LARGE')
}
export async function readCatalogue(
  credentials: Credentials,
  http: typeof fetch = fetch,
): Promise<Catalogue> {
  // Sequential provider reads; never retry a mutation, including on HTTP 429.
  const accounts = await collection(credentials, 'accounts', account, http)
  const vatAccounts = await collection(
    credentials,
    'vat-accounts',
    vatAccount,
    http,
  )
  const journals: Catalogue['journals'] = []
  const seen = new Set<string>()
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    const data = z
      .object({
        items: z.array(journal).max(1000),
        cursor: z.string().max(50).nullable().optional(),
      })
      .parse(
        await request(
          credentials,
          `${JOURNALS}/journals${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          http,
        ),
      )
    journals.push(...data.items)
    if (!data.cursor) return { accounts, vatAccounts, journals }
    if (seen.has(data.cursor)) break
    seen.add(data.cursor)
    cursor = data.cursor
  }
  throw new EconomicError('ECONOMIC_CATALOGUE_TOO_LARGE')
}
export function usableAccount(value: Catalogue['accounts'][number]) {
  return (
    !value.barred &&
    !value.blockDirectEntries &&
    !value.contraAccount &&
    ['profitAndLoss', 'status'].includes(value.accountType)
  )
}
export function usableJournal(value: Catalogue['journals'][number]) {
  return (
    !value.isStandingJournal && [0, 5].includes(value.allowedEntryType ?? 0)
  )
}
export function validateMapping(
  catalogue: Catalogue,
  journalNumber: number,
  lines: { account: string; vatCode: string }[],
) {
  const selected = catalogue.journals.find((j) => j.number === journalNumber)
  if (!selected || !usableJournal(selected))
    throw new EconomicError('ECONOMIC_JOURNAL_INVALID')
  for (const line of lines) {
    const a = catalogue.accounts.find(
      (a) => a.accountNumber === Number(line.account),
    )
    if (!a || !usableAccount(a))
      throw new EconomicError('ECONOMIC_ACCOUNT_INVALID')
    const v = catalogue.vatAccounts.find((v) => v.vatCode === line.vatCode)
    // All amounts, including VAT itself, are already frozen. Nonzero automatic
    // codes would create another tax calculation and are never accepted in v1.
    if (!v || v.barred || v.ratePercentage !== 0)
      throw new EconomicError('ECONOMIC_ZERO_VAT_REQUIRED')
  }
}

export const exportLine = z.object({
  key: z.string().max(80),
  account: accountNumber,
  side: z.enum(['debit', 'credit']),
  amountOre: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  vatCode,
})
export type ExportLine = z.infer<typeof exportLine>
export type DraftInput = {
  entryTypeNumber: 5
  journalNumber: number
  date: string
  accountNumber: number
  vatCode: string
  amount: string
  currency: 'DKK'
  text: string
}
/** Decimal formatting only; all arithmetic stays in integer øre. */
function kroner(ore: number, negative: boolean) {
  const value = BigInt(ore)
  return `${negative ? '-' : ''}${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
function returnedKroner(value: number) {
  const parts = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!parts) return null
  return `${parts[1]}${parts[2]}.${(parts[3] ?? '').padEnd(2, '0')}`
}
export function serializeDraftBody(body: { entries: DraftInput[] }) {
  return `{"entries":[${body.entries
    .map(({ amount, ...entry }) => {
      if (!/^-?\d+\.\d{2}$/.test(amount))
        throw new EconomicError('INVALID_INPUT')
      return `${JSON.stringify(entry).slice(0, -1)},"amount":${amount}}`
    })
    .join(',')}]}`
}
export function draftBody(input: {
  journalNumber: number
  date: string
  description: string
  lines: ExportLine[]
}) {
  integer.parse(input.journalNumber)
  z.iso.date().parse(input.date)
  z.string().min(1).max(200).parse(input.description)
  const lines = z.array(exportLine).min(2).max(100).parse(input.lines)
  if (
    lines.reduce(
      (sum, line) =>
        sum + BigInt(line.amountOre) * (line.side === 'debit' ? 1n : -1n),
      0n,
    ) !== 0n
  )
    throw new EconomicError('VOUCHER_UNBALANCED')
  return {
    entries: lines.map((line): DraftInput => ({
      entryTypeNumber: 5,
      journalNumber: input.journalNumber,
      date: `${input.date}T00:00:00`,
      accountNumber: Number(line.account),
      vatCode: line.vatCode,
      amount: kroner(line.amountOre, line.side === 'credit'),
      currency: 'DKK',
      text: input.description,
    })),
  }
}
const returnedEntry = z.object({
  entryNumber: integer,
  voucherNumber: z.number().int().min(0).max(999999999),
  journalNumber: integer,
  entryTypeNumber: z.literal(5),
  currency: z.literal('DKK'),
  date: z.string(),
  accountNumber: integer,
  vatCode,
  amount: z.number(),
  text: z.string(),
  contraAccountNumber: z.number().nullable().optional(),
})
/** A single POST followed only by reads of the exact returned entry identifiers. */
export async function createDrafts(
  credentials: Credentials,
  body: { entries: DraftInput[] },
  requestId: string,
  onAttempt: () => void,
  http: typeof fetch = fetch,
) {
  // Validate all local parameters before granting the one external attempt.
  token.parse(credentials.appSecret)
  token.parse(credentials.grant)
  z.uuid().parse(requestId)
  onAttempt()
  const result = z
    .object({ entryNumbers: z.array(integer).max(100) })
    .parse(
      await request(
        credentials,
        `${JOURNALS}/draft-entries/bulk`,
        http,
        body,
        requestId,
      ),
    )
  if (
    result.entryNumbers.length !== body.entries.length ||
    new Set(result.entryNumbers).size !== result.entryNumbers.length
  )
    throw new EconomicError('ECONOMIC_UNVERIFIED_ENTRIES')
  const remaining = [...body.entries]
  const vouchers = new Set<number>()
  for (const id of result.entryNumbers) {
    const row = returnedEntry.parse(
      await request(credentials, `${JOURNALS}/draft-entries/${id}`, http),
    )
    if (row.entryNumber !== id || row.contraAccountNumber != null)
      throw new EconomicError('ECONOMIC_UNVERIFIED_ENTRIES')
    const index = remaining.findIndex(
      (expected) =>
        row.journalNumber === expected.journalNumber &&
        row.date.slice(0, 10) === expected.date.slice(0, 10) &&
        row.accountNumber === expected.accountNumber &&
        row.vatCode === expected.vatCode &&
        returnedKroner(row.amount) === expected.amount &&
        row.text === expected.text,
    )
    if (index < 0) throw new EconomicError('ECONOMIC_UNVERIFIED_ENTRIES')
    remaining.splice(index, 1)
    vouchers.add(row.voucherNumber)
  }
  if (vouchers.size !== 1) throw new EconomicError('ECONOMIC_MULTIPLE_VOUCHERS')
  return { voucherNumber: [...vouchers][0] }
}
