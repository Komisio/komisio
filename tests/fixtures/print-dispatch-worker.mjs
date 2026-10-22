import { appendFileSync } from 'node:fs'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'

// Subprocess-only synthetic transport. Never connects to a printer or Supabase.
process.once('message', async ({ directory, output, job, crash }) => {
  try {
    const journal = await createDispatchJournal(directory)
    const result = await journal.dispatch(job, {
      authorize: async () => true,
      send: async () => {
        appendFileSync(output, 'sent\n')
        if (crash) {
          process.send({ sent: true })
          await new Promise(() => {})
        }
      },
    })
    process.send({ state: result.state })
  } catch (error) {
    process.send({ error: error.code ?? 'UNEXPECTED_ERROR' })
  }
  process.disconnect()
})
