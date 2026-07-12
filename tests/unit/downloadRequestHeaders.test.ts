import { describe, expect, test } from 'vitest';
import {
  downloadableRequestHeaders,
  requestHeadersForUrl,
  requestHeadersForUrls
} from '../../src/server/utils/downloadRequestHeaders.js';

describe('downloadableRequestHeaders', () => {
  test('preserves browser request context needed to replay a media request', () => {
    expect(
      downloadableRequestHeaders({
        Authorization: 'Bearer media-token',
        Cookie: 'session=abc',
        DNT: '1',
        Origin: 'https://source.example.test',
        'Sec-Fetch-Dest': 'video',
        'X-Media-Token': 'custom-token'
      })
    ).toEqual({
      Authorization: 'Bearer media-token',
      Cookie: 'session=abc',
      DNT: '1',
      Origin: 'https://source.example.test',
      'Sec-Fetch-Dest': 'video',
      'X-Media-Token': 'custom-token'
    });
  });

  test('drops routing, framing, connection, proxy, and downloader-owned headers', () => {
    expect(
      downloadableRequestHeaders({
        ':authority': 'media.example.test',
        Connection: 'keep-alive',
        'Content-Length': '123',
        Expect: '100-continue',
        Host: 'media.example.test',
        'If-Match': '"current"',
        'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'If-None-Match': '"stale"',
        'If-Range': '"partial"',
        'If-Unmodified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'Keep-Alive': 'timeout=5',
        'Proxy-Authorization': 'Basic secret',
        'Proxy-Connection': 'keep-alive',
        RANGE: 'bytes=0-1023',
        TE: 'trailers',
        Trailer: 'Expires',
        'Transfer-Encoding': 'chunked',
        Upgrade: 'websocket',
        'User-Agent': 'Mozilla/5.0 test'
      })
    ).toEqual({ 'User-Agent': 'Mozilla/5.0 test' });
  });

  test('replays captured headers only to the origin that supplied them', () => {
    const headers = { Authorization: 'Bearer secret', Cookie: 'session=secret', 'User-Agent': 'test' };

    expect(
      requestHeadersForUrl(headers, 'https://media.example.test/master.m3u8', 'https://media.example.test/segment.ts')
    ).toEqual(headers);
    expect(
      requestHeadersForUrl(headers, 'https://media.example.test/master.m3u8', 'https://cdn.example.test/segment.ts')
    ).toEqual({});
    expect(
      requestHeadersForUrls(headers, 'https://media.example.test/master.m3u8', [
        'https://media.example.test/key.bin',
        'https://cdn.example.test/segment.ts'
      ])
    ).toEqual({});
  });
});
