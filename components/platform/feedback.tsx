export function Feedback({
  error,
  success,
}: {
  error?: string
  success?: string
}) {
  return (
    <div aria-live="polite">
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {success && !error && <p className="notice notice-success">{success}</p>}
    </div>
  )
}
