import { useState, useEffect } from 'react'
import { wsClient } from './wsClient'

/** Devuelve true si el WebSocket está conectado en este momento.
 *  Se re-renderiza cuando cambia la conexión. */
export function useWsConnected(): boolean {
  const [connected, setConnected] = useState(() => wsClient.isConnected())
  useEffect(() => wsClient.onConnectionChange(setConnected), [])
  return connected
}
