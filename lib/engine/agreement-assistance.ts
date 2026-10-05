import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'
import { resolveReceptionAssistance } from '../assistance/reception-config'
import { generateAgreement, agreementSuggestion } from '../assistance/agreement'

export const agreementAssistanceCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  baseId: z.uuid().nullable(),
  language: z.enum(locales),
})
export type RestoredAgreementDraft = {
  requestId: string
  language: z.infer<typeof agreementAssistanceCommand>['language']
  output: z.infer<typeof agreementSuggestion> | null
  decisionId: string | null
}

/** Restore the latest actor-owned attempt; no browser storage contains agreement text. */
export async function readAgreementDraft(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  baseId: string | null,
  draftId?: string,
): Promise<RestoredAgreementDraft | null> {
  const query = client
    .from('agreement_ai_attempts')
    .select('id,context')
    .eq('tenant_id', tenantId)
  const attempts = await (
    draftId ? query.eq('id', draftId) : query.eq('created_by', userId)
  )
    .order('created_at', { ascending: false })
    .limit(1)
  if (attempts.error) throw new Error('Unable to read agreement draft')
  const attempt = attempts.data?.[0]
  if (!attempt || attempt.context.agreementId !== baseId) return null
  const [result, decision] = await Promise.all([
    client
      .from('agreement_ai_results')
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
    throw new Error('Unable to read agreement draft')
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
    output: result.data ? agreementSuggestion.parse(result.data.output) : null,
    decisionId: decision.data?.id ?? null,
  }
}
export async function runAgreementAssistance(
  client: SupabaseClient,
  input: unknown,
  signal: AbortSignal,
) {
  const c = agreementAssistanceCommand.parse(input)
  const config = await resolveReceptionAssistance(client, c.tenantId)
  if (!config) throw new Error('ASSISTANCE_DISABLED')
  const start = await client.rpc('begin_agreement_assistance', {
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
      output: agreementSuggestion.nullable(),
      context: z.unknown(),
    })
    .parse(start.data)
  if (!run.reserved)
    return { id: c.requestId, status: run.status, output: run.output }
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const result = await generateAgreement(config, run.context, signal)
    output = result.output
    usage = result.usage
  } catch {
    /* Persist a failed attempt without logging provider text or credentials. */
  }
  const end = await client.rpc('complete_agreement_assistance', {
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
