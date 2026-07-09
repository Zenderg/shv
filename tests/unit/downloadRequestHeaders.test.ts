import { describe, expect, test } from 'vitest';
import { downloadableRequestHeaders } from '../../src/server/utils/downloadRequestHeaders.js';

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
});
