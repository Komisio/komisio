'use client'

import { useWorkActivity } from './work-activity'
import { createContext, useContext } from 'react'

const LoadingMessageContext = createContext('')

export function LoadingMessageProvider({
  message,
  children,
}: {
  message: string
  children: React.ReactNode
}) {
  return (
    <LoadingMessageContext.Provider value={message}>
      {children}
    </LoadingMessageContext.Provider>
  )
}

export function LoadingMessage() {
  useWorkActivity(true)
  const message = useContext(LoadingMessageContext)
  return (
    <div className="card work-loading" role="status">
      <span className="work-spinner" aria-hidden="true" />
      {message}
    </div>
  )
}
