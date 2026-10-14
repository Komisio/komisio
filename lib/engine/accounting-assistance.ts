import { z } from 'zod'
import { accountingMapBody } from './accounting'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'
import { resolveReceptionAssistance } from '../assistance/reception-config'
import { generateAccountSuggestions } from '../assistance/accounting'
import { accountSuggestion } from '../accounting/account-suggestions'

export const accountingAssistanceCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  baseId: z.uuid().nullable(),
  language: z.enum(locales),
})
export type RestoredAccountingDraft = {
  requestId: string
  language: z.infer<typeof accountingAssistanceCommand>['language']
  output: z.infer<typeof accountSuggestion> | null
  decisionId: string | null
}

/** Restore the latest actor-owned attempt; no browser storage contains accounting text. */
export async function readAccountingDraft(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  baseId: string | null,
  draftId?: string,
): Promise<RestoredAccountingDraft | null> {
  const query = client
    .from('accounting_ai_attempts')
    .select('id,context,created_at')
    .eq('tenant_id', tenantId)
    .eq('created_by', userId)
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
    output: result.data ? accountSuggestion.parse(result.data.output) : null,
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
  const start = await client.rpc('begin_accounting_assistance', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_base: c.baseId,
    p_language: c.language,
    p_model: config.model,
  })
  if (start.error) throw new Error(start.error.message)
  const run = z
    .object({
      reserved: z.boolean(),
      status: z.enum(['pending', 'ready', 'failed']),
      output: accountSuggestion.nullable(),
      context: z.unknown(),
    })
    .parse(start.data)
  if (!run.reserved)
    return { id: c.requestId, status: run.status, output: run.output }
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const result = await generateAccountSuggestions(config, run.context, signal)
    const context = z
      .object({ currentMap: accountingMapBody })
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
