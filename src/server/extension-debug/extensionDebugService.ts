export type ExtensionDebugEventDraft = {
  candidateUrl?: string | null;
  details?: Record<string, unknown>;
  eventType: string;
  frameUrl?: string | null;
  jobId?: string | null;
  reason?: string | null;
  status?: string | null;
  tabId?: number | null;
};

export type ExtensionDebugEvent = {
  candidateUrl: string | null;
  details: Record<string, unknown>;
  eventType: string;
  frameUrl: string | null;
  id: number;
  jobId: string | null;
  reason: string | null;
  receivedAt: string;
  status: string | null;
  tabId: number | null;
};

const MAX_EXTENSION_DEBUG_EVENTS = 500;

export class ExtensionDebugService {
  private events: ExtensionDebugEvent[] = [];
  private sequence = 0;

  list(limit = 100): ExtensionDebugEvent[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.events.slice(-boundedLimit);
  }

  record(draft: ExtensionDebugEventDraft): ExtensionDebugEvent {
    this.sequence += 1;
    const event = {
      candidateUrl: draft.candidateUrl ?? null,
      details: draft.details ?? {},
      eventType: draft.eventType,
      frameUrl: draft.frameUrl ?? null,
      id: this.sequence,
      jobId: draft.jobId ?? null,
      reason: draft.reason ?? null,
      receivedAt: new Date().toISOString(),
      status: draft.status ?? null,
      tabId: draft.tabId ?? null
    };
    this.events.push(event);
    this.events = this.events.slice(-MAX_EXTENSION_DEBUG_EVENTS);
    return event;
  }
}
