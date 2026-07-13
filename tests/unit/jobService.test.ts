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
    const run = claim(service, job.id);
    service.transitionActive(job.id, run.runId, 'analyzing', 'downloading', null);
    service.transitionActive(job.id, run.runId, 'downloading', 'processing', 0.82, { selectedCandidateId: null });

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
    const run = claim(service, job.id);
    service.transitionActive(job.id, run.runId, 'analyzing', 'downloading', null);
    service.transitionActive(job.id, run.runId, 'downloading', 'processing', null);
    service.transitionActive(job.id, run.runId, 'processing', 'adding_subtitles', 0.4, { progressLabel: 'Adding subtitles' });

    service.recoverInterruptedJobs();

    const recovered = service.requireJob(job.id);
    expect(recovered.status).toBe('pending');
    expect(recovered.stageProgress).toBeNull();
    expect(service.updateProgress(job.id, 'adding_subtitles', run.runId, 0.8, 'Adding subtitles')).toBe(false);
    expect(service.requireJob(job.id).stageProgress).toBeNull();
  });

  test('claims a pending job atomically across database connections', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-job-claim-'));
    const databasePath = path.join(root, 'db.sqlite');
    const firstDb = openDatabase(databasePath);
    const secondDb = openDatabase(databasePath);
    const first = new JobService(firstDb);
    const second = new JobService(secondDb);
    const categoryId = '7b2d8d17-a7dd-4f1d-b143-82ed9b70dbd6';
    firstDb.prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)').run(
      categoryId,
      'test',
      'test',
      new Date().toISOString()
    );
    const job = first.create('https://example.test/page', categoryId);

    const claimed = first.claimNextRunnableJob();

    expect(claimed?.job.id).toBe(job.id);
    expect(second.claimNextRunnableJob()).toBeNull();
  });

  test('rejects manual selection after a job has been claimed', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    service.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4', 0.9)]);
    const selected = service.listCandidates(job.id)[0];
    claim(service, job.id);

    expect(() => service.selectCandidate(job.id, selected.id)).toThrow(/current state/);
    expect(service.requireJob(job.id).status).toBe('analyzing');
    expect(service.nextRunnableJob()).toBeNull();
  });

  test('keeps the owned output path across recovery and rejects callbacks from the old run', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);
    const firstRun = claim(service, job.id);
    service.transitionActive(job.id, firstRun.runId, 'analyzing', 'downloading', null);
    service.transitionActive(job.id, firstRun.runId, 'downloading', 'processing', 0.5);
    expect(service.reserveOutputPath(job.id, firstRun.runId, 'test/video.mp4')).toEqual({
      relativePath: 'test/video.mp4',
      reserved: true
    });

    service.recoverInterruptedJobs();
    const secondRun = claim(service, job.id);
    service.transitionActive(job.id, secondRun.runId, 'analyzing', 'downloading', null);
    service.transitionActive(job.id, secondRun.runId, 'downloading', 'processing', null);

    expect(service.reserveOutputPath(job.id, secondRun.runId, 'test/video-2.mp4')).toEqual({
      relativePath: 'test/video.mp4',
      reserved: false
    });
    expect(service.updateProgress(job.id, 'processing', firstRun.runId, 0.9, 'Old run')).toBe(false);
    expect(service.updateProgress(job.id, 'processing', secondRun.runId, 0.6, 'New run')).toBe(true);
  });

  test('clears terminal timestamps when a job is made runnable again', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/page', categoryId);

    failClaimedJob(service, job.id, 'temporary failure');
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
    failClaimedJob(service, job.id, 'temporary failure');
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
    failClaimedJob(service, job.id, 'Manifest request failed with HTTP 410');

    const retried = service.retry(job.id);

    expect(retried.status).toBe('pending');
    expect(retried.selectedCandidateId).toBeNull();
    expect(service.listCandidates(job.id)).toEqual([]);
  });

  test('replaces a failed source transactionally and clears run metadata and output ownership', () => {
    const { service, categoryId } = createJobService();
    const job = service.create('https://example.test/old', categoryId);
    const run = claim(service, job.id);
    service.transitionActive(job.id, run.runId, 'analyzing', 'downloading', null);
    service.transitionActive(job.id, run.runId, 'downloading', 'processing', null);
    service.reserveOutputPath(job.id, run.runId, 'test/old.mp4');
    service.transitionActive(job.id, run.runId, 'processing', 'failed', null, { errorMessage: 'failed' });

    const replaced = service.replaceSource(job.id, 'https://example.test/new');

    expect(replaced).toMatchObject({
      completedAt: null,
      sourceUrl: 'https://example.test/new',
      startedAt: null,
      status: 'pending'
    });
    expect(service.outputRelativePath(job.id)).toBeNull();
  });

  test('keeps canceled jobs visible until they are explicitly deleted', () => {
    const { db, service, categoryId } = createJobService();
    const pending = service.create('https://example.test/pending', categoryId);
    const canceled = service.create('https://example.test/canceled', categoryId);
    const completed = service.create('https://example.test/completed', categoryId);

    service.cancel(canceled.id);
    db.prepare("UPDATE download_jobs SET status = 'completed', progress = 1, stage_progress = 1 WHERE id = ?").run(completed.id);

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
  return { categoryId, db, service };
}

function claim(service: JobService, expectedJobId: string) {
  const claimed = service.claimNextRunnableJob();
  expect(claimed?.job.id).toBe(expectedJobId);
  return claimed!;
}

function failClaimedJob(service: JobService, jobId: string, errorMessage: string): void {
  const run = claim(service, jobId);
  service.transitionActive(jobId, run.runId, 'analyzing', 'failed', 0, { errorMessage });
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
