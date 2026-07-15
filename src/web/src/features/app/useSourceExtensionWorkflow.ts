import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { SourceExtensionKind } from '../../../../shared/sourceExtension';
import { api, type DownloadJob } from '../../lib/api';
import { checkSourceExtension, openSourceWithExtension, type ExtensionStatus } from '../../lib/extensionBridge';
import { message } from '../../utils/format';
import { appQueryKeys } from './queries';
import type { ExtensionDialogState } from './AppDialogs';

export function useSourceExtensionWorkflow({
  profile,
  queryClient
}: {
  profile: SourceExtensionKind | undefined;
  queryClient: QueryClient;
}) {
  const [dialog, setDialog] = useState<ExtensionDialogState>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [sourceTabOpenedJobIds, setSourceTabOpenedJobIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    function handleSourceHelperEvent(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.channel !== 'SHV_SOURCE_HELPER_EVENT' ||
        event.data?.event?.type !== 'source-selected'
      ) {
        return;
      }
      const selectedJobId = typeof event.data.event.jobId === 'string' ? event.data.event.jobId : null;
      if (selectedJobId) {
        setSourceTabOpenedJobIds((current) => omitKey(current, selectedJobId));
      }
      void queryClient.invalidateQueries({ queryKey: appQueryKeys.queue });
    }

    window.addEventListener('message', handleSourceHelperEvent);
    return () => window.removeEventListener('message', handleSourceHelperEvent);
  }, [queryClient]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    let active = true;
    setStatus(null);
    void checkSourceExtension(profile).then((nextStatus) => {
      if (active) {
        setStatus(nextStatus);
      }
    });
    return () => {
      active = false;
    };
  }, [profile]);

  async function chooseSource(job: DownloadJob) {
    const currentProfile = await currentSourceExtensionProfile();
    const nextStatus = await checkSourceExtension(currentProfile);
    setStatus(nextStatus);
    if (nextStatus.kind !== 'ready') {
      setError(null);
      setDialog({ job, kind: 'issue', status: nextStatus });
      return;
    }
    await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, currentProfile);
    setSourceTabOpenedJobIds((current) => ({ ...current, [job.id]: true }));
  }

  async function recheck(job: DownloadJob | null) {
    setError(null);
    try {
      const currentProfile = await currentSourceExtensionProfile();
      const nextStatus = await checkSourceExtension(currentProfile);
      setStatus(nextStatus);
      if (nextStatus.kind !== 'ready') {
        setDialog({ job, kind: 'issue', status: nextStatus });
        return;
      }
      if (job) {
        await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, currentProfile);
        setSourceTabOpenedJobIds((current) => ({ ...current, [job.id]: true }));
      }
      setDialog({ kind: 'none' });
    } catch (caught) {
      setError(message(caught));
    }
  }

  function closeDialog() {
    setDialog({ kind: 'none' });
    setError(null);
  }

  function showUpdateIssue() {
    if (status?.kind === 'outdated') {
      setError(null);
      setDialog({ job: null, kind: 'issue', status });
    }
  }

  async function currentSourceExtensionProfile(): Promise<SourceExtensionKind> {
    if (profile) {
      return profile;
    }
    const config = await queryClient.fetchQuery({
      queryFn: api.runtimeConfig,
      queryKey: appQueryKeys.runtimeConfig,
      staleTime: Number.POSITIVE_INFINITY
    });
    return config.sourceExtensionProfile;
  }

  return {
    chooseSource,
    closeDialog,
    dialog,
    error,
    recheck,
    showUpdateIssue,
    sourceTabOpenedJobIds,
    status
  };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
