import { join } from 'node:path'
import {
  deviceScope,
  createPrinterSessions,
  createDeviceAuthorizer,
  createDeviceTokenProvider,
  createWeblinkRpc,
} from './auth.mjs'
import { createCredentialStore } from './credentials.mjs'
import { createAttemptStore } from './attempts.mjs'
import { createDispatchJournal } from './dispatch.mjs'
import { createWeblinkService } from './service.mjs'

/**
 * Compose the pilot for an EXISTING paired device. The caller provides a private
 * existing directory and a separately held 32-byte encryption key. This does not
 * create an Auth user, consume pairing codes, activate a printer, install a proxy
 * or start polling. No service-role key is accepted by the device HTTP adapters.
 * Own the attempt lock before reading/rotating credentials, including at startup.
 */
export async function createProvisionedWeblinkService({
  directory,
  encryptionKey,
  scope: input,
  url,
  publishableKey,
  proxyHost,
  proxySecret,
  port = 0,
  fetchImpl = fetch,
}) {
  const scope = deviceScope(input)
  // Validate the root itself with the same private-directory ownership contract.
  const store = await createCredentialStore(directory, encryptionKey)
  const attempts = await createAttemptStore(join(directory, 'attempts'), scope)
  try {
    const lookupCredential = async (deviceId) => {
      if (deviceId !== scope.deviceId) return null
      const record = await store.load(deviceId)
      if (
        !record ||
        Object.keys(scope).some((key) => record[key] !== scope[key])
      )
        return null
      return record
    }
    if (!(await lookupCredential(scope.deviceId)))
      throw new Error('PRINT_DEVICE_UNAUTHORIZED')
    const getAccessToken = createDeviceTokenProvider({
      url,
      publishableKey,
      scope,
      store,
      fetchImpl,
    })
    const authorizeDevice = createDeviceAuthorizer({
      url,
      publishableKey,
      getAccessToken,
      fetchImpl,
    })
    const sessions = createPrinterSessions({
      lookupCredential,
      authorizeDevice,
    })
    const rpc = createWeblinkRpc({
      url,
      publishableKey,
      scope,
      getAccessToken,
      fetchImpl,
    })
    const journal = await createDispatchJournal(join(directory, 'dispatch'))
    return await createWeblinkService({
      scope,
      sessions,
      rpc,
      journal,
      attempts,
      proxyHost,
      proxySecret,
      port,
    })
  } catch {
    await attempts.close()
    throw new Error('PRINT_SERVICE_UNAVAILABLE')
  }
}
