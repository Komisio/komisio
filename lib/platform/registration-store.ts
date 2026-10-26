import { serverClient } from '@/lib/supabase/server'
import {
  readPublicRegistrationStore,
  registrationTokenFromNext,
} from '@/lib/engine/seller-registration'

/** Only the server-resolved name is passed to auth forms, never URL-supplied text. */
export async function registrationStoreForNext(next: unknown) {
  const token = registrationTokenFromNext(next)
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true' || !token) return null
  return readPublicRegistrationStore(await serverClient(), token)
}
