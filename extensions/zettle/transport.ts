import { cursor } from './purchase'
export interface ZettleTransport {
  /** Tenant connection is bound by the host, never by a provider payload. */
  fetchPage(input: {
    cursor: string | null
    signal: AbortSignal
  }): Promise<unknown>
}
/** In-memory recordings for tests; no HTTP endpoint, OAuth token or ambient fetch. */
export function fixtureZettleTransport(
  recordings: ReadonlyArray<{ cursor: string | null; response: unknown }>,
): ZettleTransport {
  const entries = recordings.map((r) => ({
    cursor: cursor.parse(r.cursor),
    response: structuredClone(r.response),
  }))
  if (new Set(entries.map((e) => e.cursor)).size !== entries.length)
    throw new Error('ZETTLE_DUPLICATE_CURSOR')
  return {
    async fetchPage(input) {
      input.signal.throwIfAborted()
      const key = cursor.parse(input.cursor),
        entry = entries.find((e) => e.cursor === key)
      if (!entry) throw new Error('ZETTLE_FIXTURE_CURSOR_UNKNOWN')
      return structuredClone(entry.response)
    },
  }
}
