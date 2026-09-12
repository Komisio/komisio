import { receptionDerivative } from '../media/reception-image'
export async function receptionImage(bytes: Uint8Array) {
  const data = await receptionDerivative(bytes)
  return `data:image/jpeg;base64,${data.toString('base64')}`
}
