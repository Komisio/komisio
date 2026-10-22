import { deviceScope } from './auth.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const states = [
  'dispatching',
  'transport_accepted',
  'outcome_unknown',
  'printed',
  'cancelled',
]

/**
 * One bounded pass, never a polling/retry loop. The caller supplies and retains
 * an attempt ID before making the call; recovery must reuse it. The database
 * permits transmission only in the first response, independently of the journal.
 * The bridge runtime invokes this explicitly; there are no startup/polling effects.
 */
export function createWeblinkQueueWorker({
  scope: input,
  rpc,
  journal,
  authorize,
  send,
}) {
  const scope = deviceScope(input)
  let running = false

  async function run(attemptId) {
    if (typeof attemptId !== 'string' || !UUID.test(attemptId))
      throw new Error('INVALID_PRINT_ATTEMPT')
    if (running) throw new Error('PRINT_WORKER_BUSY')
    running = true
    try {
      try {
        if ((await authorize(scope)) !== true) throw new Error()
      } catch {
        throw new Error('PRINT_DEVICE_UNAUTHORIZED')
      }
      let claimed
      try {
        claimed = await rpc('claim_weblink_print_job', {
          p_tenant: scope.tenantId,
          p_printer: scope.printerId,
          p_attempt: attemptId,
        })
      } catch {
        return Object.freeze({ state: 'claim_unknown', attemptId })
      }
      if (claimed === null) return Object.freeze({ state: 'empty', attemptId })
      if (
        !claimed ||
        typeof claimed.jobId !== 'string' ||
        !UUID.test(claimed.jobId) ||
        claimed.attemptId !== attemptId ||
        !states.includes(claimed.state) ||
        typeof claimed.canSend !== 'boolean'
      )
        return Object.freeze({ state: 'claim_unknown', attemptId })
      const evidence = { jobId: claimed.jobId, attemptId }
      if (!claimed.canSend)
        return Object.freeze({
          ...evidence,
          state: 'held',
          recordedState: claimed.state,
        })
      if (claimed.state !== 'dispatching')
        return Object.freeze({ ...evidence, state: 'claim_unknown' })
      let outcome = 'outcome_unknown'
      try {
        const result = await journal.dispatch(
          {
            ...scope,
            jobId: claimed.jobId,
            payload: claimed.payload,
            copies: claimed.copies,
          },
          { authorize, send },
        )
        if (
          result.jobId === claimed.jobId &&
          result.state === 'transport_accepted'
        )
          outcome = 'transport_accepted'
      } catch {
        // A durable reservation is never released, including on bad payload,
        // authorization loss or unavailable local storage. Never echo peer text.
      }
      try {
        const finished = await rpc('finish_weblink_print_job', {
          p_tenant: scope.tenantId,
          p_job: claimed.jobId,
          p_attempt: attemptId,
          p_outcome: outcome,
        })
        if (finished !== claimed.jobId) outcome = 'outcome_unknown'
      } catch {
        outcome = 'outcome_unknown'
      }
      return Object.freeze({ ...evidence, state: outcome })
    } finally {
      running = false
    }
  }

  return Object.freeze({ run })
}
