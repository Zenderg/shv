import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { appQueryKeys, useCategoryLabelsQuery } from '../app/queries';
import { api } from '../../lib/api';

export function useLibraryLabels(categoryId: string) {
  const queryClient = useQueryClient();
  const query = useCategoryLabelsQuery(categoryId);
  const [filter, setFilter] = useState<{ categoryId: string; label: string } | null>(null);
  const activeLabel = filter?.categoryId === categoryId ? filter.label : null;

  useEffect(() => {
    if (activeLabel && query.data && !query.data.items.some((item) => sameLabel(item.name, activeLabel))) {
      setFilter(null);
    }
  }, [activeLabel, query.data]);

  async function rename(from: string, to: string) {
    const summary = await api.renameCategoryLabel(categoryId, from, to);
    queryClient.setQueryData(appQueryKeys.categoryLabels(categoryId), summary);
    if (activeLabel && sameLabel(activeLabel, from)) {
      const renamed = summary.items.find((item) => sameLabel(item.name, to));
      setFilter(renamed ? { categoryId, label: renamed.name } : null);
    }
    await queryClient.resetQueries({ queryKey: appQueryKeys.mediaCategory(categoryId) });
    return summary;
  }

  async function remove(label: string) {
    const summary = await api.removeCategoryLabel(categoryId, label);
    queryClient.setQueryData(appQueryKeys.categoryLabels(categoryId), summary);
    if (activeLabel && sameLabel(activeLabel, label)) {
      setFilter(null);
    }
    await queryClient.resetQueries({ queryKey: appQueryKeys.mediaCategory(categoryId) });
    return summary;
  }

  return {
    activeLabel,
    query,
    remove,
    rename,
    select: (label: string | null) => setFilter(label ? { categoryId, label } : null)
  };
}

function sameLabel(left: string, right: string): boolean {
  return left.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
    === right.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
