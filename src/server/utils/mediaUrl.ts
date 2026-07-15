export function normalizeHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Media URL must be a valid HTTP(S) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Media URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Media URL must not include credentials');
  }
  return parsed.toString();
}
