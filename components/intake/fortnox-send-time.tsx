'use client'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useBusyState } from '@/components/platform/work-activity'
import { Button } from '@/components/ui/button'
import {
  fortnoxSchedule,
  sendTime,
  type FortnoxSchedule,
  type saveFortnoxScheduleInput,
} from '@/lib/engine/fortnox-schedule'
import type { z } from 'zod'
import type { Dictionary } from '@/lib/i18n'

export function FortnoxSendTime({
  tenantId,
  initial,
  canEdit,
  d,
}: {
  tenantId: string
  initial: FortnoxSchedule
  canEdit: boolean
  d: Dictionary
}) {
  const t = d.fortnox.automation
  const router = useRouter()
  const [current, setCurrent] = useState(initial)
  const [time, setTime] = useState(initial.time)
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef<z.infer<typeof saveFortnoxScheduleInput> | null>(null)
  const running = useRef(false)
  useUnsavedChanges(
    canEdit && (locked || time !== current.time) ? d.leaveUnsaved : null,
  )
  async function save() {
    if (
      !canEdit ||
      running.current ||
      refused ||
      !sendTime.safeParse(time).success
    )
      return
    const command = pending.current ?? {
      tenantId,
      requestId: crypto.randomUUID(),
      previousId: current.id,
      time,
    }
    pending.current = command
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/fortnox-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      const schedule = fortnoxSchedule.safeParse(result.schedule)
      if (
        response.ok &&
        result.ok === true &&
        schedule.success &&
        schedule.data.id === command.requestId &&
        schedule.data.time === command.time
      ) {
        setCurrent(schedule.data)
        setTime(schedule.data.time)
        pending.current = null
        setLocked(false)
        setMessage(t.timeSaved)
        router.refresh()
      } else if (response.status >= 400 && response.status < 500) {
        setRefused(true)
        setError(t.timeChanged)
      } else setError(t.timeUncertain)
    } catch {
      setError(t.timeUncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="row wrap" style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor="fortnox-send-time">{t.timeLabel}</label>
          <input
            id="fortnox-send-time"
            type="time"
            step={60}
            value={time}
            disabled={!canEdit || locked}
            onChange={(e) => {
              setTime(e.target.value)
              setMessage('')
            }}
          />
        </div>
        {canEdit && (
          <Button
            type="submit"
            variant="secondary"
            disabled={
              busy ||
              refused ||
              (!locked &&
                (time === current.time || !sendTime.safeParse(time).success))
            }
          >
            {busy ? t.busy : locked ? d.intake.retry : t.saveTime}
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {refused && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {d.intake.reload}
        </Button>
      )}
    </form>
  )
}
