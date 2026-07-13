import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { JobService } from '../../src/server/jobs/jobService.js';
import { openDatabase } from '../../src/server/storage/database.js';

describe('JobService', () => {
  test('merges newly captured candidates without deleting existing manual choices', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-jobs-'));
    const db = openDatabase(path.join(root, 'db.sqlite'));
    const service = new JobService(db);
    const categoryId = '7b2d8d17-a7dd-4f1d-b143-82ed9b70dbd6';
    db.prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)').run(
      categoryId,
      'test',
      'test',
      new Date().toISOString()
    );
    const job = service.create('https://example.test/page', categoryId);

    service.saveCandidates(job.id, [
      candidate('https://media.example.test/first.mp4', 0.7),
      candidate('https://media.example.test/duplicate.mp4', 0.7)
    ]);
    service.mergeCandidates(job.id, [
      candidate('https://media.example.test/duplicate.mp4', 0.92),
      candidate('https://media.example.test/new.mp4', 0.86)
    ]);

    const urls = service.listCandidates(job.id).map((item) => item.url);
    expect(urls).toEqual([
      'https://media.example.test/duplicate.mp4',
      'https://media.example.test/new.mp4',
      'https://media.example.test/first.mp4'
    ]);
    expect(service.listCandidates(job.id)).toHaveLength(3);
  });

  test('persists subtitle tracks captured with media candidates', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);

    service.saveCandidates(job.id, [
      {
        ...candidate('https://media.example.test/master.m3u8', 0.92),
        kind: 'hls',
        contentType: 'application/vnd.apple.mpegurl',
        manifestType: 'hls',
        subtitleTracks: [
          {
            contentType: 'text/vtt',
            format: 'webvtt',
            isDefault: false,
            isSelected: true,
            label: 'Russian',
            language: 'ru',
            source: 'network',
            url: 'https://media.example.test/subtitles/ru.vtt'
          }
        ]
      }
    ]);

    expect(service.listCandidates(job.id)[0].subtitleTracks).toEqual([
      {
        contentType: 'text/vtt',
        format: 'webvtt',
        isDefault: false,
        isSelected: true,
        label: 'Russian',
        language: 'ru',
        source: 'network',
        url: 'https://media.example.test/subtitles/ru.vtt'
      }
    ]);
  });

  test('recovers interrupted active jobs on startup', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.transition(job.id, 'processing', 0.82, { selectedCandidateId: null });

    service.recoverInterruptedJobs();

    const recovered = service.requireJob(job.id);
    expect(recovered.status).toBe('pending');
    expect(recovered.stageProgress).toBeNull();
    expect(recovered.progressLabel).toBeNull();
    expect(recovered.startedAt).toBeNull();
    expect(recovered.completedAt).toBeNull();
    expect(recovered.errorMessage).toBeNull();
  });

  test('recovers interrupted subtitle processing and rejects late progress writes', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.transition(job.id, 'adding_subtitles', 0.4, { progressLabel: 'Adding subtitles' });

    service.recoverInterruptedJobs();

    const recovered = service.requireJob(job.id);
    expect(recovered.status).toBe('pending');
    expect(recovered.stageProgress).toBeNull();
    expect(service.updateProgress(job.id, 'adding_subtitles', 0.8, 'Adding subtitles')).toBe(false);
    expect(service.requireJob(job.id).stageProgress).toBeNull();
  });

  test('clears terminal timestamps when a job is made runnable again', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);

    service.transition(job.id, 'failed', 0, { errorMessage: 'temporary failure' });
    expect(service.requireJob(job.id).completedAt).not.toBeNull();

    service.retry(job.id);
    const retried = service.requireJob(job.id);
    expect(retried.status).toBe('pending');
    expect(retried.startedAt).toBeNull();
    expect(retried.completedAt).toBeNull();
    expect(retried.errorMessage).toBeNull();
  });

  test('clears run timestamps when a source waits for subtitle selection', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.transition(job.id, 'analyzing', 0.1);
    service.transition(job.id, 'failed', 0, { errorMessage: 'temporary failure' });
    expect(service.requireJob(job.id).startedAt).not.toBeNull();
    expect(service.requireJob(job.id).completedAt).not.toBeNull();
    service.saveCandidates(job.id, [
      {
        ...candidate('https://media.example.test/master.m3u8', 0.92),
        kind: 'hls',
        contentType: 'application/vnd.apple.mpegurl',
        manifestType: 'hls',
        subtitleTracks: [
          {
            contentType: 'text/x-ssa',
            format: 'ass',
            isDefault: false,
            isSelected: null,
            label: 'Russian',
            language: 'ru',
            source: 'network',
            url: 'https://media.example.test/subtitles/ru.ass'
          }
        ]
      }
    ]);

    const selected = service.selectCandidate(job.id, service.listCandidates(job.id)[0].id);

    expect(selected.status).toBe('needs_subtitle_selection');
    expect(selected.startedAt).toBeNull();
    expect(selected.completedAt).toBeNull();
  });

  test('retry clears selected candidates so signed media URLs are rediscovered', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.saveCandidates(job.id, [candidate('https://media.example.test/signed.m3u8?expires=old', 0.92)]);
    const staleCandidate = service.listCandidates(job.id)[0];
    service.selectCandidate(job.id, staleCandidate.id);
    service.transition(job.id, 'failed', 0, { errorMessage: 'Manifest request failed with HTTP 410' });

    const retried = service.retry(job.id);

    expect(retried.status).toBe('pending');
    expect(retried.selectedCandidateId).toBeNull();
    expect(service.listCandidates(job.id)).toEqual([]);
  });

  test('keeps canceled jobs visible until they are explicitly deleted', () => {
    const { service, categoryId } = createJobService();
    const pending = service.create('https://example.test/pending', categoryId);
    const canceled = service.create('https://example.test/canceled', categoryId);
    const completed = service.create('https://example.test/completed', categoryId);

    service.cancel(canceled.id);
    service.transition(completed.id, 'completed', 1);

    expect(service.snapshot().jobs.map((job) => job.id)).toEqual([pending.id, canceled.id]);
  });

  test('deletes a job and its captured candidates', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4', 0.9)]);

    service.delete(job.id);

    expect(service.get(job.id)).toBeNull();
    expect(service.listCandidates(job.id)).toEqual([]);
  });
});

function createJobService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-jobs-'));
  const db = openDatabase(path.join(root, 'db.sqlite'));
  const service = new JobService(db);
  const categoryId = '7b2d8d17-a7dd-4f1d-b143-82ed9b70dbd6';
  db.prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)').run(
    categoryId,
    'test',
    'test',
    new Date().toISOString()
  );
  return { categoryId, service };
}

function candidate(url: string, confidence: number) {
  return {
    kind: 'direct' as const,
    url,
    contentType: 'video/mp4',
    manifestType: null,
    resolution: null,
    bitrate: null,
    durationSeconds: null,
    sizeBytes: null,
    confidence,
    headers: {}
  };
}
