import { setTimeout as delay } from 'node:timers/promises'

/** Serialized, bounded polling. Held outcomes never enter another runOnce. */
export async function pollWeblinkService({
  service,
  signal,
  pollMs = 3000,
  reportMs = 60000,
  onState = () => {},
}) {
  if (
    !Number.isInteger(pollMs) ||
    pollMs < 100 ||
    pollMs > 60000 ||
    !Number.isInteger(reportMs) ||
    reportMs < 100 ||
    reportMs > 300000 ||
    !signal
  )
    throw new Error('INVALID_PRINT_POLLER')
  let held = false,
    prior,
    lastReport = 0
  try {
    while (!signal.aborted) {
      let state = 'waiting'
      if (held) state = 'held'
      else if (service.status().connected) {
        try {
          const result = await service.runOnce()
          if (
            ['held', 'claim_unknown', 'outcome_unknown'].includes(result.state)
          )
            held = true
          state = held
            ? 'held'
            : result.state === 'empty'
              ? 'idle'
              : 'transport_accepted'
        } catch {
          if (service.status().connected) {
            held = true
            state = 'held'
          }
        }
      }
      if (state !== prior) {
        onState({ state })
        prior = state
      }
      if (Date.now() - lastReport >= reportMs) {
        lastReport = Date.now()
        await service.reportStatus?.(held).catch(() => {})
      }
      await delay(pollMs, undefined, { signal }).catch((error) => {
        if (error.name !== 'AbortError') throw error
      })
    }
  } finally {
    await service.close()
  }
}
