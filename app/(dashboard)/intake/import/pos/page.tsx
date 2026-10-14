import { redirect } from 'next/navigation'

/** Preserve existing bookmarks in the shared import workspace. */
export default function PosImportPage() {
  redirect('/intake/import/items#item-import-pos')
}
