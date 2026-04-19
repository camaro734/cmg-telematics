// Sprint 6 will implement this. Interface defined here so Sprint 6 activates it without touching Sprint 5 files.

export interface WsClient {
  connect: (token: string, tenantId: string) => void
  disconnect: () => void
  onTelemetry: (cb: (data: unknown) => void) => () => void
}

export const wsClient: WsClient = {
  connect: () => {},
  disconnect: () => {},
  onTelemetry: () => () => {},
}
