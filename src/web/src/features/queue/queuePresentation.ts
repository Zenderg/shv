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
  status: string;
}

const STATUS_PRESENTATIONS: Record<string, Omit<QueueJobPresentation, 'notice'>> = {
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
};

export function queueJobPresentation({ errorCode, status }: QueueJobPresentationInput): QueueJobPresentation {
  const known = STATUS_PRESENTATIONS[status];
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
    notice: noticeFor(status, errorCode)
  };
}

function noticeFor(status: string, errorCode: string | null): QueueJobNotice | null {
  if (status === 'needs_manual_selection') {
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

function humanizeStatus(status: string): string {
  const normalized = status.trim().replaceAll('_', ' ');
  if (!normalized) {
    return 'Unknown status';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
