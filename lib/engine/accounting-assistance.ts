import { z } from 'zod'
import { accountingMapBody } from './accounting'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'
import { resolveReceptionAssistance } from '../assistance/reception-config'
import { generateAccountSuggestions } from '../assistance/accounting'
import { accountSuggestion } from '../accounting/account-suggestions'
import type { AccountSuggestion } from '../accounting/account-suggestions'
import {
  economicCandidates,
  economicSuggestion,
  eligibleEconomicAccounts,
} from '../accounting/economic-suggestions'
import { economicCatalogue } from './economic'

export const accountingAssistanceCommand = z
  .strictObject({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    baseId: z.uuid().nullable(),
    language: z.enum(locales),
    destination: z.enum(['sie', 'economic']).default('sie'),
    agreementNumber: z.number().int().positive().max(2147483647).optional(),
  })
  .refine((c) =>
    c.destination === 'economic'
      ? c.agreementNumber !== undefined
      : c.agreementNumber === undefined,
  )
export type RestoredAccountingDraft = {
  requestId: string
  language: z.infer<typeof accountingAssistanceCommand>['language']
  output: AccountSuggestion | null
  decisionId: string | null
}

/** Restore the latest actor-owned attempt; no browser storage contains accounting text. */
export async function readAccountingDraft(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  baseId: string | null,
  draftId?: string,
  destination: 'sie' | 'economic' = 'sie',
): Promise<RestoredAccountingDraft | null> {
  const query = client
    .from('accounting_ai_attempts')
    .select('id,context,created_at')
    .eq('tenant_id', tenantId)
    .eq('created_by', userId)
    .eq(
      'prompt_version',
      destination === 'economic' ? 'economic-accounts-v1' : 'accounting-v1',
    )
  const attempts = await (draftId ? query.eq('id', draftId) : query)
    .order('created_at', { ascending: false })
    .limit(1)
  if (attempts.error) throw new Error('Unable to read accounting draft')
  const attempt = attempts.data?.[0]
  if (
    !attempt ||
    attempt.context.mapId !== baseId ||
    Date.parse(attempt.created_at) <= Date.now() - 7 * 24 * 60 * 60 * 1000
  )
    return null
  const [result, decision] = await Promise.all([
    client
      .from('accounting_ai_results')
      .select('output')
      .eq('tenant_id', tenantId)
      .eq('id', attempt.id)
      .maybeSingle(),
    client
      .from('operation_decisions')
      .select('id,outcome,decided_by')
      .eq('tenant_id', tenantId)
      .eq('operation_id', attempt.id)
      .maybeSingle(),
  ])
  if (result.error || decision.error)
    throw new Error('Unable to read accounting draft')
  if (
    (result.data && !result.data.output) ||
    (decision.data &&
      (decision.data.outcome !== 'executed' ||
        decision.data.decided_by !== userId))
  )
    return null
  return {
    requestId: attempt.id,
    language: z.enum(locales).parse(attempt.context.language),
    output: result.data
      ? (destination === 'economic'
          ? economicSuggestion
          : accountSuggestion
        ).parse(result.data.output)
      : null,
    decisionId: decision.data?.id ?? null,
  }
}
export async function runAccountingAssistance(
  client: SupabaseClient,
  input: unknown,
  signal: AbortSignal,
) {
  const c = accountingAssistanceCommand.parse(input)
  const config = await resolveReceptionAssistance(client, c.tenantId)
  if (!config) throw new Error('ASSISTANCE_DISABLED')
  const args = {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_base: c.baseId,
    p_language: c.language,
    p_model: config.model,
  }
  let economicArgs = {}
  if (c.destination === 'economic') {
    // Recover a lost response from the immutable attempt without another provider read.
    const prior = await client
      .from('accounting_ai_attempts')
      .select('context')
      .eq('tenant_id', c.tenantId)
      .eq('id', c.requestId)
      .maybeSingle()
    if (prior.error) throw new Error('ASSISTANCE_FAILED')
    if (prior.data) {
      const context = z
        .object({
          destination: z.literal('economic'),
          agreementNumber: z.number().int(),
          connectionRevision: z.uuid(),
          accounts: economicCandidates,
        })
        .safeParse(prior.data.context)
      if (
        !context.success ||
        context.data.agreementNumber !== c.agreementNumber
      )
        throw new Error('REQUEST_CONFLICT')
      economicArgs = {
        p_agreement: c.agreementNumber,
        p_revision: context.data.connectionRevision,
        p_accounts: context.data.accounts,
      }
    } else {
      const catalogue = await economicCatalogue(client, c.tenantId, process.env)
      if (catalogue.agreementNumber !== c.agreementNumber)
        throw new Error('REQUEST_CONFLICT')
      economicArgs = {
        p_agreement: catalogue.agreementNumber,
        p_revision: catalogue.connectionRevision,
        p_accounts: eligibleEconomicAccounts(catalogue),
      }
    }
  }
  const outputSchema =
    c.destination === 'economic' ? economicSuggestion : accountSuggestion
  const start = await client.rpc(
    c.destination === 'economic'
      ? 'begin_economic_accounting_assistance'
      : 'begin_accounting_assistance',
    { ...args, ...economicArgs },
  )
  if (start.error) throw new Error(start.error.message)
  const run = z
    .object({
      reserved: z.boolean(),
      status: z.enum(['pending', 'ready', 'failed']),
      output: outputSchema.nullable(),
      context: z.unknown(),
    })
    .parse(start.data)
  if (!run.reserved)
    return { id: c.requestId, status: run.status, output: run.output }
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const result = await generateAccountSuggestions(
      config,
      run.context,
      signal,
      fetch,
      c.destination,
    )
    const context = z
      .object({
        currentMap:
          c.destination === 'economic'
            ? z.record(z.string(), z.unknown())
            : accountingMapBody,
      })
      .parse(run.context)
    output =
      result.output &&
      !result.output.rows.some((row) => context.currentMap[row.key])
        ? result.output
        : null
    usage = result.usage
  } catch {
    /* Persist a failed attempt without logging provider text or credentials. */
  }
  const end = await client.rpc('complete_accounting_assistance', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_output: output,
    p_input: usage.input_tokens,
    p_output_tokens: usage.output_tokens,
  })
  if (end.error) throw new Error(end.error.message)
  return {
    id: c.requestId,
    status: output ? ('ready' as const) : ('failed' as const),
    output,
  }
}
