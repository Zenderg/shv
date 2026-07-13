import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressUpdate } from '../utils/taskProgress.js';
import type { BrowserRequestDownloadInput, DownloadResult } from './downloadEngine.js';

export async function downloadBrowserRequestMedia(input: BrowserRequestDownloadInput): Promise<DownloadResult> {
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  throwIfAborted(input.signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', browserRequestDownloadScript], { stdio: ['pipe', 'pipe', 'pipe'] });
    const removeAbortListener = onAbort(input.signal, () => child.kill('SIGTERM'));
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    const settle = (callback: () => void) => {
      removeAbortListener();
      callback();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = `${stdout}${text}`.slice(-4000);
      lineBuffer += text;
      let newlineIndex = lineBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line) {
          const progress = progressFromBrowserRequestLine(line);
          if (progress) input.onProgress(progress);
        }
        newlineIndex = lineBuffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (error) => settle(() => reject(error)));
    child.on('close', (code) => {
      if (input.signal?.aborted) {
        settle(() => reject(new JobCanceledError()));
      } else if (code === 0) {
        input.onProgress(progressUpdate(1));
        settle(resolve);
      } else {
        settle(() => reject(new Error(formatBrowserRequestDownloadError(code, `${stdout}\n${stderr}`))));
      }
    });
    child.stdin.end(JSON.stringify({ headers: input.headers, outputPath: input.outputPath, proxyUrl: input.proxyUrl, url: input.url }));
  });
  throwIfAborted(input.signal);
  return { filePath: input.outputPath, bytesWritten: fs.statSync(input.outputPath).size };
}

function progressFromBrowserRequestLine(line: string): TaskProgressUpdate | null {
  try {
    const message = JSON.parse(line) as { activity?: unknown; progress?: unknown };
    const progress = typeof message.progress === 'number' ? message.progress : null;
    if (progress != null && Number.isFinite(progress)) {
      return progressUpdate(Math.min(0.99, Math.max(0, progress)));
    }
    return message.activity === true ? activityUpdate() : null;
  } catch {
    return null;
  }
}

function formatBrowserRequestDownloadError(code: number | null, log: string): string {
  const detail = redactSignedUrls(log.trim());
  return detail
    ? `Browser-impersonated media download exited with code ${code}: ${detail}`
    : `Browser-impersonated media download exited with code ${code}`;
}

function redactSignedUrls(line: string): string {
  return line.replace(/https?:\/\/[^\s'\"]+/g, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.origin}${parsed.pathname}${parsed.search ? '?<redacted>' : ''}`;
    } catch {
      return '<redacted-url>';
    }
  });
}

const browserRequestDownloadScript = String.raw`
import json
import os
import re
import sys

from curl_cffi import requests


def report(progress=None):
    message = {"activity": True}
    if progress is not None:
        message["progress"] = progress
    print(json.dumps(message), flush=True)


payload = json.loads(sys.stdin.read())
url = payload["url"]
headers = payload["headers"]
output_path = payload["outputPath"]
proxy_url = payload["proxyUrl"]
existing_bytes = 0
range_header = headers.get("Range") or headers.get("range") or ""
if range_header.startswith("bytes=") and range_header.endswith("-"):
    try:
        existing_bytes = max(0, int(range_header.removeprefix("bytes=").removesuffix("-")))
    except ValueError:
        existing_bytes = 0

os.makedirs(os.path.dirname(output_path), exist_ok=True)
response = requests.get(url, headers=headers, impersonate="chrome", stream=True, timeout=30, allow_redirects=False, proxy=proxy_url)
retried_without_range = False
if existing_bytes > 0 and response.status_code == 206:
    content_range = response.headers.get("content-range") or response.headers.get("Content-Range") or ""
    content_range_match = re.match(r"^bytes\s+(\d+)-\d+/(?:\d+|\*)$", content_range, re.IGNORECASE)
    if not content_range_match or int(content_range_match.group(1)) != existing_bytes:
        response.close()
        headers = {name: value for name, value in headers.items() if name.lower() != "range"}
        response = requests.get(url, headers=headers, impersonate="chrome", stream=True, timeout=30, allow_redirects=False, proxy=proxy_url)
        retried_without_range = True
if retried_without_range and response.status_code != 200:
    response.close()
    raise RuntimeError(f"Resume retry returned HTTP {response.status_code}; expected a complete HTTP 200 response")
if response.status_code < 200 or response.status_code >= 300:
    raise RuntimeError(f"HTTP {response.status_code}")

content_range = response.headers.get("content-range") or response.headers.get("Content-Range")
content_length = int(response.headers.get("content-length") or response.headers.get("Content-Length") or 0)
total = content_length
if content_range and "/" in content_range:
    try:
        total = int(content_range.rsplit("/", 1)[1])
    except ValueError:
        total = content_length

append = response.status_code == 206 and existing_bytes > 0
written = existing_bytes if append else 0
mode = "ab" if append else "wb"
last_report = written
reported_cap = False
with open(output_path, mode + "") as output:
    for chunk in response.iter_content(chunk_size=262144):
        if not chunk:
            continue
        output.write(chunk)
        written += len(chunk)
        if total > 0 and not reported_cap and (written - last_report >= 1048576 or written >= total):
            progress = min(0.99, written / total)
            report(progress)
            reported_cap = progress >= 0.99
            last_report = written
        else:
            report()

if total > 0 and not reported_cap:
    report(min(0.99, written / total))
`;
