import { storeApiResponse } from '@/lib/http/store-inventory-api'
async function handle(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  return storeApiResponse(request, (await context.params).segments)
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE }
