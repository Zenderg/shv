import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
]);

export function sanitizeName(input: string, fallback = 'untitled'): string {
  const cleaned = input
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  const base = cleaned.length > 0 ? cleaned : fallback;
  const reservedSafe = WINDOWS_RESERVED_NAMES.has(base.toLowerCase()) ? `${base}-item` : base;
  return reservedSafe.slice(0, 140);
}

export function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }
  throw new Error(`Path escapes configured root: ${target}`);
}

export function ensureDirInside(root: string, target: string): string {
  const safeTarget = assertInsideRoot(root, target);
  fs.mkdirSync(safeTarget, { recursive: true });
  return safeTarget;
}

export function uniquePath(directory: string, desiredName: string, reservedPaths: ReadonlySet<string> = new Set()): string {
  const parsed = path.parse(sanitizeName(desiredName));
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  let index = 2;
  while (fs.existsSync(candidate) || reservedPaths.has(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname);
    return sanitizeName(decodeURIComponent(basename || parsed.hostname), 'video');
  } catch {
    return 'video';
  }
}
