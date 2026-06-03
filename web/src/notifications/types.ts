export interface Notification {
  id: string;
  teamId: string;
  type: string;
  projectSlug: string;
  scenarioId?: string;
  title?: string;
  message?: string;
  createdAt?: unknown;
}
