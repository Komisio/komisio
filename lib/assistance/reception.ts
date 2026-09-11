import {
  prepareReceptionProposal,
  receptionSession,
  type ReceptionSession,
} from '../engine/reception'

export type ReceptionAssistance = {
  // Provider output is untrusted. The orchestrator binds identity and provenance.
  suggest: (session: ReceptionSession, signal: AbortSignal) => Promise<unknown>
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
  // Isolate input: an adapter must not mutate the source set used for validation.
  const candidate = await adapter.suggest(structuredClone(session), signal)
  signal.throwIfAborted()
  return {
    status: 'proposed' as const,
    proposal: prepareReceptionProposal(session, candidate, proposalId),
  }
}
