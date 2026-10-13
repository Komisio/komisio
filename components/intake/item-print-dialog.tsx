'use client'

import { useId, useRef } from 'react'
import Link from '@/components/platform/working-link'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { Printer } from '@/lib/engine/printing'
import { PrintJobButton } from './print-job-button'

/** Keep the form mounted across closing/reopening, including uncertain retries. */
export function ItemPrintDialog({
  tenantId,
  itemId,
  kind,
  printers,
  manage,
  d,
  intake,
}: {
  tenantId: string
  itemId: string
  kind: 'item' | 'markdown'
  printers: Printer[]
  manage: boolean
  d: Dictionary['printing']
  intake: Dictionary['intake']
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-secondary no-print"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => dialog.current?.showModal()}
      >
        {d.zebraPrint}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="item-print-dialog no-print"
        aria-labelledby={`${id}-title`}
        onClose={() => trigger.current?.focus()}
      >
        <div className="item-print-dialog-heading">
          <h2 id={`${id}-title`}>{d.zebraPrint}</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={() => dialog.current?.close()}
          >
            {d.close}
          </Button>
        </div>
        <PrintJobButton
          tenantId={tenantId}
          referenceId={itemId}
          referenceKind="item"
          kind={kind}
          printers={printers}
          d={d}
          intake={intake}
          compact
        />
        {!printers.some((p) => p.active) && manage && (
          <Link className="text-link" href="/settings?tab=printing">
            {d.title}
          </Link>
        )}
      </dialog>
    </>
  )
}
