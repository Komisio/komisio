import { createHmac, randomUUID } from 'node:crypto'
import type { Locale } from '../i18n'

type Events = {
  'tenant.created': {
    tenant_id: string
    shop_name: string
    owner_email: string
    owner_display_name: string
    locale: Locale
    marketing_consent?: boolean
  }
}

let warnedAboutConfiguration = false
function configurationWarning() {
  if (warnedAboutConfiguration) return
  warnedAboutConfiguration = true
  console.warn('events-webhook: invalid configuration; delivery disabled')
}

// Server-side only. Never log configuration, payloads, response bodies or exceptions.
export async function emitEvent<E extends keyof Events>(
  event: E,
  data: Events[E],
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const endpoint = process.env.KOMISIO_EVENTS_WEBHOOK_URL?.trim()
    if (!endpoint) return
    const secret = process.env.KOMISIO_EVENTS_WEBHOOK_SECRET
    const timeout = Number(
      process.env.KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS ?? '3000',
    )
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      configurationWarning()
      return
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !secret?.trim() ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 30000
    ) {
      configurationWarning()
      return
    }
    const eventId = randomUUID()
    const now = new Date()
    const timestamp = String(Math.floor(now.getTime() / 1000))
    const body = JSON.stringify({
      event,
      event_id: eventId,
      created_at: now.toISOString(),
      data,
    })
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), timeout)
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Komisio-Event': event,
        'X-Komisio-Delivery': eventId,
        'X-Komisio-Timestamp': timestamp,
        'X-Komisio-Signature': `sha256=${signature}`,
      },
      body,
    })
    // Do not read or retain a receiver's response body.
    await response.body?.cancel()
    if (!response.ok)
      console.warn(
        `events-webhook: delivery failed (status=${response.status})`,
      )
  } catch {
    console.warn('events-webhook: delivery failed')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// The caller supplies Next's after() so tests can verify that the HTTP response
// is independent of delivery. Scheduling failures must not undo a committed create.
export function scheduleEvent<E extends keyof Events>(
  afterResponse: (callback: () => Promise<void>) => void,
  event: E,
  data: Events[E] | (() => Promise<Events[E]>),
) {
  if (!process.env.KOMISIO_EVENTS_WEBHOOK_URL?.trim()) return
  try {
    afterResponse(async () => {
      try {
        await emitEvent(event, typeof data === 'function' ? await data() : data)
      } catch {
        // A preference lookup failure must never invent consent or fail creation.
        console.warn('events-webhook: payload unavailable; delivery skipped')
      }
    })
  } catch {
    console.warn('events-webhook: scheduling failed')
  }
}
