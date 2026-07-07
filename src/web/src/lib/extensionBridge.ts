import {
  DEV_SOURCE_EXTENSION_ID,
  PROD_SOURCE_EXTENSION_ID,
  sourceExtensionTargetForOrigin
} from '../../../shared/sourceExtension';

export { DEV_SOURCE_EXTENSION_ID, PROD_SOURCE_EXTENSION_ID, sourceExtensionTargetForOrigin };

export const SOURCE_EXTENSION_ID = PROD_SOURCE_EXTENSION_ID;
export const SOURCE_EXTENSION_REQUIRED_VERSION = '1.0.22';
export const SOURCE_EXTENSION_PROTOCOL_VERSION = 1;
export const SOURCE_EXTENSION_DOWNLOAD_PATH = sourceExtensionTargetForOrigin(currentWindowOrigin()).downloadPath;

export interface ExtensionHandshake {
  installed: true;
  protocolVersion: number;
  version: string;
}

export type ExtensionStatus =
  | { kind: 'missing' }
  | { currentVersion: string; kind: 'outdated'; requiredVersion: string }
  | { kind: 'ready'; version: string };

export interface OpenSourceRequest {
  jobId: string;
  sourceUrl: string;
  titleHint: string | null;
}

interface ChromeRuntime {
  lastError?: { message?: string };
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void
  ) => void;
}

declare global {
  interface Window {
    chrome?: {
      runtime?: ChromeRuntime;
    };
  }
}

let bridgeRequestSequence = 0;

export function isVersionAtLeast(current: string, required: string): boolean {
  const currentParts = parseVersion(current);
  const requiredParts = parseVersion(required);
  const length = Math.max(currentParts.length, requiredParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const requiredPart = requiredParts[index] ?? 0;
    if (currentPart > requiredPart) {
      return true;
    }
    if (currentPart < requiredPart) {
      return false;
    }
  }
  return true;
}

export function evaluateExtensionHandshake(
  handshake: ExtensionHandshake | null,
  requiredVersion = SOURCE_EXTENSION_REQUIRED_VERSION,
  requiredProtocolVersion = SOURCE_EXTENSION_PROTOCOL_VERSION
): ExtensionStatus {
  if (!handshake?.installed) {
    return { kind: 'missing' };
  }
  if (handshake.protocolVersion < requiredProtocolVersion || !isVersionAtLeast(handshake.version, requiredVersion)) {
    return { currentVersion: handshake.version, kind: 'outdated', requiredVersion };
  }
  return { kind: 'ready', version: handshake.version };
}

export async function checkSourceExtension(): Promise<ExtensionStatus> {
  const handshake = await sendExtensionMessage<ExtensionHandshake>({
    protocolVersion: SOURCE_EXTENSION_PROTOCOL_VERSION,
    type: 'SHV_HELLO'
  });
  return evaluateExtensionHandshake(handshake);
}

export async function openSourceWithExtension(input: OpenSourceRequest): Promise<void> {
  const response = await sendExtensionMessage<{ error?: string; ok: boolean }>({
    jobId: input.jobId,
    protocolVersion: SOURCE_EXTENSION_PROTOCOL_VERSION,
    sourceUrl: input.sourceUrl,
    titleHint: input.titleHint,
    type: 'SHV_OPEN_SOURCE'
  }, {
    bridgeFallback: 'runtime-missing-only',
    runtimeTimeoutMs: 12000
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'The browser extension did not open the source tab.');
  }
}

async function sendExtensionMessage<T>(
  message: unknown,
  options: { bridgeFallback?: 'always' | 'runtime-missing-only'; runtimeTimeoutMs?: number } = {}
): Promise<T | null> {
  const runtime = window.chrome?.runtime;
  if (runtime?.sendMessage) {
    const response = await sendChromeRuntimeMessage<T>(runtime, message, options.runtimeTimeoutMs ?? 1200);
    if (response) {
      return response;
    }
    if (options.bridgeFallback === 'runtime-missing-only') {
      return null;
    }
  }
  return sendContentScriptBridgeMessage<T>(message);
}

async function sendChromeRuntimeMessage<T>(runtime: ChromeRuntime, message: unknown, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    try {
      runtime.sendMessage(currentSourceExtensionId(), message, (response) => {
        window.clearTimeout(timeout);
        if (runtime.lastError) {
          resolve(null);
          return;
        }
        resolve((response ?? null) as T | null);
      });
    } catch {
      window.clearTimeout(timeout);
      resolve(null);
    }
  });
}

async function sendContentScriptBridgeMessage<T>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = createBridgeRequestId();
    const extensionId = currentSourceExtensionId();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      resolve(null);
    }, 1200);

    function handleMessage(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.channel !== 'SHV_SOURCE_HELPER_RESPONSE' ||
        event.data?.extensionId !== extensionId ||
        event.data?.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve((event.data.response ?? null) as T | null);
    }

    window.addEventListener('message', handleMessage);
    window.postMessage({ channel: 'SHV_SOURCE_HELPER', extensionId, message, requestId }, window.location.origin);
  });
}

function currentSourceExtensionId(): string {
  return sourceExtensionTargetForOrigin(currentWindowOrigin()).id;
}

function currentWindowOrigin(): string {
  return typeof window === 'undefined' ? 'https://shv.local' : window.location.origin;
}

function createBridgeRequestId(): string {
  const cryptoSource = window.crypto;
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID();
  }
  if (typeof cryptoSource?.getRandomValues === 'function') {
    try {
      const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return formatUuidBytes(bytes);
    } catch {
      // LAN deployments can run over plain HTTP where Web Crypto is limited.
    }
  }
  bridgeRequestSequence += 1;
  return [
    'bridge',
    Date.now().toString(36),
    bridgeRequestSequence.toString(36),
    Math.random().toString(36).slice(2)
  ].join('-');
}

function formatUuidBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}

function parseVersion(value: string): number[] {
  return value.split('.').map((part) => Number.parseInt(part, 10) || 0);
}
