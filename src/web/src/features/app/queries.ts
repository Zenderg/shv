import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type MediaPage } from '../../lib/api';

export const appQueryKeys = {
  categories: ['categories'] as const,
  categoryLabelsRoot: ['category-labels'] as const,
  categoryLabels: (categoryId: string) => ['category-labels', categoryId] as const,
  mediaRoot: ['media'] as const,
  mediaCategory: (categoryId: string) => ['media', categoryId] as const,
  media: (categoryId: string, label: string | null) => ['media', categoryId, label] as const,
  queue: ['queue'] as const,
  runtimeConfig: ['runtime-config'] as const
};

export function useCategoriesQuery() {
  return useQuery({
    queryFn: api.categories,
    queryKey: appQueryKeys.categories
  });
}

export function useCategoryLabelsQuery(categoryId: string) {
  return useQuery({
    enabled: categoryId.length > 0,
    queryFn: () => api.categoryLabels(categoryId),
    queryKey: appQueryKeys.categoryLabels(categoryId)
  });
}

export function useMediaQuery(categoryId: string, label: string | null) {
  return useInfiniteQuery({
    enabled: categoryId.length > 0,
    getNextPageParam: (lastPage: MediaPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.media(categoryId, pageParam, 60, label),
    queryKey: appQueryKeys.media(categoryId, label)
  });
}

export function useQueueQuery() {
  return useQuery({
    queryFn: api.queue,
    queryKey: appQueryKeys.queue,
    refetchInterval: 2000
  });
}

export function useRuntimeConfigQuery() {
  return useQuery({
    queryFn: api.runtimeConfig,
    queryKey: appQueryKeys.runtimeConfig,
    staleTime: Number.POSITIVE_INFINITY
  });
}
