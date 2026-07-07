import { describe, expect, test } from 'vitest';
import { classifyMediaUrl } from '../../src/server/candidate-detection/candidateDetection.js';

describe('candidate detection', () => {
  test('rejects browser-local and explicit byte-range media URLs', () => {
    expect(classifyMediaUrl('blob:https://example.test/video-id', 'video/mp4')).toBeNull();
    expect(classifyMediaUrl('https://media.example.test/video?bytes=0-6402', 'video/webm')).toBeNull();
  });

  test('requires a video extension before accepting generic octet-stream responses', () => {
    expect(classifyMediaUrl('https://media.example.test/', 'application/octet-stream')).toBeNull();
    expect(classifyMediaUrl('https://media.example.test/video.mp4', 'application/octet-stream')?.kind).toBe('direct');
  });
});
