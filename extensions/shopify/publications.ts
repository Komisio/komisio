import { z } from 'zod'
import { graphql } from './auth'

export async function listPublications(
  shop: string,
  token: string,
  http?: typeof fetch,
) {
  const data = await graphql(
    shop,
    token,
    `
      query {
        publications(first: 50, catalogType: APP) {
          nodes {
            id
            catalog {
              title
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `,
    {},
    http,
  )
  const parsed = z
    .object({
      publications: z.object({
        nodes: z
          .array(
            z.object({
              id: z.string().regex(/^gid:\/\/shopify\/Publication\/\d+$/),
              catalog: z.object({ title: z.string().max(200) }).nullable(),
            }),
          )
          .max(50),
        pageInfo: z.object({ hasNextPage: z.boolean() }),
      }),
    })
    .parse(data)
  if (parsed.publications.pageInfo.hasNextPage)
    throw new Error('SHOPIFY_PUBLICATION_INVALID')
  return parsed.publications.nodes
    .filter((p) => p.catalog)
    .map((p) => ({ id: p.id, name: p.catalog!.title }))
}

/** Idempotent publication; never unpublishes channels managed outside Komisio. */
export async function publishProduct(
  shop: string,
  token: string,
  productId: string,
  publicationIds: string[],
  http?: typeof fetch,
) {
  const data = await graphql(
    shop,
    token,
    `
      mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            message
          }
        }
      }
    `,
    {
      id: productId,
      input: publicationIds.map((publicationId) => ({ publicationId })),
    },
    http,
  )
  const result = z
    .object({
      publishablePublish: z.object({
        userErrors: z.array(z.object({ message: z.string() })),
      }),
    })
    .parse(data)
  if (result.publishablePublish.userErrors.length)
    throw new Error('SHOPIFY_PUBLICATION_FAILED')
}
