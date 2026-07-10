const NON_REPLAYABLE_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export function downloadableRequestHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => {
      const normalized = key.trim().toLowerCase();
      return normalized.length > 0 && !normalized.startsWith(':') && !NON_REPLAYABLE_HEADERS.has(normalized);
    })
  );
}

export function requestHeadersForUrl(
  headers: Record<string, string>,
  capturedUrl: string,
  targetUrl: string
): Record<string, string> {
  return sameOrigin(capturedUrl, targetUrl) ? { ...headers } : {};
}

export function requestHeadersForUrls(
  headers: Record<string, string>,
  capturedUrl: string,
  targetUrls: string[]
): Record<string, string> {
  return targetUrls.every((targetUrl) => sameOrigin(capturedUrl, targetUrl)) ? { ...headers } : {};
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
