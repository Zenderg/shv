import { describe, expect, test } from 'vitest';
import { queueJobPresentation } from '../../src/web/src/features/queue/queuePresentation.js';

describe('queue job presentation', () => {
  test.each(['analyzing', 'downloading', 'processing', 'adding_subtitles'])('%s is an active state that shows progress', (status) => {
    expect(queueJobPresentation({ errorCode: null, status })).toMatchObject({
      showProgress: true,
      tone: 'active'
    });
  });

  test.each(['pending', 'needs_manual_selection', 'needs_subtitle_selection', 'failed', 'canceled', 'completed'])(
    '%s does not show progress',
    (status) => {
      expect(queueJobPresentation({ errorCode: null, status }).showProgress).toBe(false);
    }
  );

  test.each(['needs_manual_selection', 'needs_subtitle_selection'])('%s is attention, not failure', (status) => {
    expect(queueJobPresentation({ errorCode: 'manual_selection_required', status })).toMatchObject({
      showProgress: false,
      tone: 'attention'
    });
  });

  test('uses error codes for friendly failure copy without inspecting technical details', () => {
    expect(queueJobPresentation({ errorCode: 'network_interrupted', status: 'failed' }).notice).toEqual({
      summary: 'The source stopped responding',
      detail: 'Check the connection, then retry the download.'
    });
    expect(queueJobPresentation({ errorCode: 'unrecognized_error', status: 'failed' }).notice).toEqual({
      summary: 'The job could not be completed',
      detail: 'Retry the job. Open technical details if it fails again.'
    });
  });

  test.each([
    ['analysis_failed', 'SHV could not analyze this source'],
    ['download_failed', 'SHV could not download this source'],
    ['processing_failed', 'The download could not be prepared for playback'],
    ['subtitle_failed', 'SHV could not add the selected subtitles'],
    ['finalization_failed', 'The video could not be added to the library']
  ])('gives %s a phase-specific recovery message', (errorCode, summary) => {
    expect(queueJobPresentation({ errorCode, status: 'failed' }).notice?.summary).toBe(summary);
  });

  test('renders a future status as safe attention state', () => {
    expect(queueJobPresentation({ errorCode: null, status: 'waiting_for_device' })).toMatchObject({
      label: 'Waiting for device',
      showProgress: false,
      tone: 'attention'
    });
  });

  test('keeps source-tab instructions visible after the extension opens the source', () => {
    expect(queueJobPresentation({ errorCode: null, sourceTabOpened: true, status: 'needs_manual_selection' }).notice).toEqual({
      summary: 'Continue in the source tab',
      detail: 'Start video playback there, then choose Use source in the SHV sidebar. You can reopen the tab if needed.'
    });
  });
});
