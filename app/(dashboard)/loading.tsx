import { dictionary } from '@/lib/i18n'
export default function Loading() {
  return (
    <div className="card" role="status">
      {dictionary().loading}
    </div>
  )
}
