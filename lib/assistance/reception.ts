import { prepareReceptionProposal, receptionSession } from '../engine/reception'

export type ReceptionEvidence = {
  sources: Array<
    { id: string; observation: string } & (
      | { kind: 'photo' }
      | { kind: 'observation' | 'price-evidence'; reference: string }
    )
  >
}

export type ReceptionAssistance = {
  // Provider output is untrusted. The orchestrator binds identity and provenance.
  suggest: (
    evidence: ReceptionEvidence,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Token usage of the last call, when the provider reports it; settles the credit reservation. */
  usage?: () => { inputTokens: number; outputTokens: number } | null
}

/** Optional replaceable port; no provider call or credentials in the core. */
export async function suggestReception(
  input: unknown,
  proposalId: string,
  adapter: ReceptionAssistance | null,
  signal: AbortSignal,
) {
  const session = receptionSession.parse(input)
  if (!adapter) return { status: 'unavailable' as const, proposal: null }
  signal.throwIfAborted()
  // Minimize before provider code runs; retain the isolated session for validation.
  const evidence: ReceptionEvidence = {
    sources: session.sources.map((source) => ({
      id: source.id,
      observation: source.observation,
      ...(source.kind === 'photo'
        ? { kind: source.kind }
        : { kind: source.kind, reference: source.reference }),
    })),
  }
  const candidate = await adapter.suggest(evidence, signal)
  signal.throwIfAborted()
  const proposal = prepareReceptionProposal(session, candidate, proposalId)
  // This applies to every adapter; model certainty cannot attest staff review.
  for (const fact of proposal.suggestions.attributes)
    fact.certainty = 'tentative'
  return {
    status: 'proposed' as const,
    proposal,
  }
}
