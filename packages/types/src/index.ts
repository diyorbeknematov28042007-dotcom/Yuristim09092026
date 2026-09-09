export type ServiceStatus = 'ok' | 'ready';

export interface ServiceHealthResponse {
  status: ServiceStatus;
  service: string;
  requestId: string;
}
