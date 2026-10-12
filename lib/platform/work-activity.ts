/** Each active UI task owns an idempotent release, including on unmount. */
export function createWorkActivity() {
  const tasks = new Set<symbol>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    snapshot: () => tasks.size,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      const task = Symbol()
      tasks.add(task)
      notify()
      return () => {
        if (tasks.delete(task)) notify()
      }
    },
  }
}
