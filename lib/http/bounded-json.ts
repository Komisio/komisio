/** Limit streamed bytes, including requests without Content-Length. */
export async function boundedJson(
  request: Request,
  limit = 4096,
): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_INPUT')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('INVALID_INPUT')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
