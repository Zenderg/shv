export type JobLogLevel = 'error' | 'info' | 'warn';

export function logJobEvent(level: JobLogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const entry = {
    at: new Date().toISOString(),
    event,
    level,
    ...fields
  };
  console.log(`[shv] ${JSON.stringify(entry)}`);
}

export function safeUrlParts(rawUrl: string): Record<string, string> {
  try {
    const url = new URL(rawUrl);
    return {
      host: url.hostname,
      path: url.pathname
    };
  } catch {
    return { host: 'invalid-url', path: '' };
  }
}

export function shortMessage(value: unknown, limit = 900): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
