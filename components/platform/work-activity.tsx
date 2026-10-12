'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react'
import { createWorkActivity } from '@/lib/platform/work-activity'

const WorkActivityContext = createContext<ReturnType<
  typeof createWorkActivity
> | null>(null)
const serverSnapshot = () => 0

export function WorkActivityProvider({
  children,
  message,
}: {
  children: ReactNode
  message: string
}) {
  const [activity] = useState(createWorkActivity)
  return (
    <WorkActivityContext.Provider value={activity}>
      {children}
      <WorkIndicator activity={activity} message={message} />
    </WorkActivityContext.Provider>
  )
}

function WorkIndicator({
  activity,
  message,
}: {
  activity: ReturnType<typeof createWorkActivity>
  message: string
}) {
  const active =
    useSyncExternalStore(
      activity.subscribe,
      activity.snapshot,
      serverSnapshot,
    ) > 0
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // Avoid flashing for fast actions; never imply completion with a fake percent.
    const timer = setTimeout(() => setVisible(active), active ? 200 : 0)
    return () => clearTimeout(timer)
  }, [active])
  return (
    <div
      className="work-announcement no-print"
      aria-live="polite"
      aria-atomic="true"
    >
      {visible && (
        <div
          className="work-indicator"
          role="progressbar"
          aria-label={message}
          data-testid="work-indicator"
        >
          <span className="work-spinner" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}
    </div>
  )
}

/** Observe actual work, not frozen forms or requests with unknown outcomes. */
export function useWorkActivity(active: boolean) {
  const activity = useContext(WorkActivityContext)
  useEffect(() => {
    if (active && activity) return activity.start()
  }, [active, activity])
}

export function useBusyState<S>(initial: S | (() => S)) {
  const state = useState(initial)
  useWorkActivity(Boolean(state[0]))
  return state
}

export function useBusyTransition() {
  const transition = useTransition()
  useWorkActivity(transition[0])
  return transition
}

const idleStart = () => () => {}
/** Explicit lifetime for work that has no existing React busy state. */
export function useStartWork() {
  return useContext(WorkActivityContext)?.start ?? idleStart
}
