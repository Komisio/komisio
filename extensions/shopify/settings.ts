import { z } from 'zod'
const publication = z.string().regex(/^gid:\/\/shopify\/Publication\/\d{1,30}$/)
export const shopifySettings = z
  .strictObject({
    mode: z.enum(['web', 'pos', 'both']),
    locationId: z.string().regex(/^gid:\/\/shopify\/Location\/\d{1,30}$/),
    locationName: z.string().min(1).max(200),
    webPublicationId: publication.nullable(),
    posPublicationId: publication.nullable(),
  })
  .refine(
    (s) =>
      (s.mode === 'pos'
        ? s.webPublicationId === null
        : s.webPublicationId !== null) &&
      (s.mode === 'web'
        ? s.posPublicationId === null
        : s.posPublicationId !== null) &&
      (s.mode !== 'both' || s.webPublicationId !== s.posPublicationId),
    { message: 'INVALID_INPUT' },
  )
