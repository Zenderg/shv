import type { JobStatus } from '../../lib/api';

export type QueueJobTone = 'active' | 'attention' | 'danger' | 'neutral';

export type QueueStatusIcon = 'analyzing' | 'canceled' | 'download' | 'error' | 'processing' | 'subtitles' | 'waiting';

export interface QueueJobNotice {
  detail: string;
  summary: string;
}

export interface QueueJobPresentation {
  icon: QueueStatusIcon;
  label: string;
  notice: QueueJobNotice | null;
  showProgress: boolean;
  tone: QueueJobTone;
}

export interface QueueJobPresentationInput {
  errorCode: string | null;
  sourceTabOpened?: boolean;
  status: string;
}

const STATUS_PRESENTATIONS = {
  pending: {
    icon: 'waiting',
    label: 'Waiting',
    showProgress: false,
    tone: 'neutral'
  },
  analyzing: {
    icon: 'analyzing',
    label: 'Analyzing source',
    showProgress: true,
    tone: 'active'
  },
  downloading: {
    icon: 'download',
    label: 'Downloading',
    showProgress: true,
    tone: 'active'
  },
  processing: {
    icon: 'processing',
    label: 'Preparing video',
    showProgress: true,
    tone: 'active'
  },
  adding_subtitles: {
    icon: 'subtitles',
    label: 'Adding subtitles',
    showProgress: true,
    tone: 'active'
  },
  needs_manual_selection: {
    icon: 'waiting',
    label: 'Choose a source',
    showProgress: false,
    tone: 'attention'
  },
  needs_subtitle_selection: {
    icon: 'subtitles',
    label: 'Choose subtitles',
    showProgress: false,
    tone: 'attention'
  },
  failed: {
    icon: 'error',
    label: 'Download failed',
    showProgress: false,
    tone: 'danger'
  },
  canceled: {
    icon: 'canceled',
    label: 'Canceled',
    showProgress: false,
    tone: 'neutral'
  },
  completed: {
    icon: 'waiting',
    label: 'Completed',
    showProgress: false,
    tone: 'neutral'
  }
} satisfies Record<JobStatus, Omit<QueueJobPresentation, 'notice'>>;

export function queueJobPresentation({ errorCode, sourceTabOpened = false, status }: QueueJobPresentationInput): QueueJobPresentation {
  const known = STATUS_PRESENTATIONS[status as JobStatus];
  if (!known) {
    return {
      icon: 'waiting',
      label: humanizeStatus(status),
      notice: {
        summary: 'This job needs attention',
        detail: 'The app received a job status this version does not recognize.'
      },
      showProgress: false,
      tone: 'attention'
    };
  }

  return {
    ...known,
    notice: noticeFor(status, errorCode, sourceTabOpened)
  };
}

function noticeFor(status: string, errorCode: string | null, sourceTabOpened: boolean): QueueJobNotice | null {
  if (status === 'needs_manual_selection') {
    if (sourceTabOpened) {
      return {
        summary: 'Continue in the source tab',
        detail: 'Start video playback there, then choose Use source in the SHV sidebar. You can reopen the tab if needed.'
      };
    }
    return {
      summary: 'Choose which source to save',
      detail: 'SHV needs your confirmation before it can continue.'
    };
  }

  if (status === 'needs_subtitle_selection') {
    return {
      summary: 'Choose a subtitle preference',
      detail: 'Select one detected track, or continue without subtitles.'
    };
  }

  if (status !== 'failed') {
    return null;
  }

  if (errorCode === 'network_interrupted') {
    return {
      summary: 'The source stopped responding',
      detail: 'Check the connection, then retry the download.'
    };
  }

  const phaseFailure = errorCode ? PHASE_FAILURE_NOTICES[errorCode] : null;
  if (phaseFailure) {
    return phaseFailure;
  }

  if (errorCode === 'pipeline_failed') {
    return {
      summary: 'SHV could not download or prepare this video',
      detail: 'Retry the job, or choose another source if the page requires browser playback.'
    };
  }

  return {
    summary: 'The job could not be completed',
    detail: 'Retry the job. Open technical details if it fails again.'
  };
}

const PHASE_FAILURE_NOTICES: Record<string, QueueJobNotice> = {
  analysis_failed: {
    summary: 'SHV could not analyze this source',
    detail: 'Retry, or choose a source through browser playback.'
  },
  download_failed: {
    summary: 'SHV could not download this source',
    detail: 'Retry the job, or choose another source.'
  },
  finalization_failed: {
    summary: 'The video could not be added to the library',
    detail: 'Check available storage and folder permissions, then retry.'
  },
  processing_failed: {
    summary: 'The download could not be prepared for playback',
    detail: 'Retry the job. Open technical details if processing fails again.'
  },
  subtitle_failed: {
    summary: 'SHV could not add the selected subtitles',
    detail: 'Retry, or choose the source again and continue without subtitles.'
  }
};

function humanizeStatus(status: string): string {
  const normalized = status.trim().replaceAll('_', ' ');
  if (!normalized) {
    return 'Unknown status';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
