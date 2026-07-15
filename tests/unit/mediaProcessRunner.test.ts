import { describe, expect, test } from 'vitest';
import {
  PROCESS_STDERR_TAIL_BYTES,
  PROCESS_STDOUT_MAX_BYTES,
  ProcessOutputTail,
  runMediaCommand,
  runWithStderr
} from '../../src/server/media-processing/mediaProcessRunner.js';

describe('media process output bounds', () => {
  test('retains only the configured stderr tail', () => {
    const output = new ProcessOutputTail(8);
    output.append(Buffer.from('first'));
    output.append(Buffer.from('-second'));

    expect(output.byteLength).toBe(8);
    expect(output.toString()).toBe('t-second');
  });

  test('preserves an early matching warning after later stderr noise', async () => {
    const warning = 'non monotonically increasing dts at packet 1';
    const stderr = await runWithStderr(
      process.execPath,
      ['-e', `process.stderr.write(${JSON.stringify(`${warning}\n`)}); process.stderr.write('x'.repeat(${PROCESS_STDERR_TAIL_BYTES + 1024}));`],
      undefined,
      (line) => /non monotonically increasing dts/i.test(line)
    );

    expect(stderr).toContain(warning);
    expect(Buffer.byteLength(stderr)).toBeLessThanOrEqual(PROCESS_STDERR_TAIL_BYTES + Buffer.byteLength(warning) + 1);
  });

  test('fails explicitly instead of returning truncated command stdout', async () => {
    await expect(runMediaCommand(
      process.execPath,
      ['-e', `process.stdout.write('x'.repeat(${PROCESS_STDOUT_MAX_BYTES + 1}))`]
    )).rejects.toThrow(`output exceeded ${PROCESS_STDOUT_MAX_BYTES} bytes`);
  });
});
