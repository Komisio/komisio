import { createHash } from 'node:crypto'
import type { CommunicationKind } from './templates'

/** One automatic notice per fact, independent of template rendering and transport. */
export function factCommunicationId(
  kind: CommunicationKind | 'welcome' | 'submission_review',
  referenceId: string,
) {
  const hex = createHash('sha1')
    .update(`komisio:communication:${kind}:${referenceId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
