'use client'

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
  const message = useContext(LoadingMessageContext)
  return (
    <div className="card" role="status">
      {message}
    </div>
  )
}
