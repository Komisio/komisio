import { createCredentialStore } from '../../scripts/print-bridge/credentials.mjs'

process.once('message', async ({ directory, key, record, revision }) => {
  try {
    const store = await createCredentialStore(
      directory,
      Buffer.from(key, 'hex'),
    )
    process.once('message', async () => {
      try {
        await store.save(record, revision)
        process.send({ saved: true }, () => process.disconnect())
      } catch (error) {
        process.send({ code: error.code }, () => process.disconnect())
      }
    })
    process.send({ ready: true })
  } catch (error) {
    process.send({ code: error.code }, () => process.disconnect())
  }
})
