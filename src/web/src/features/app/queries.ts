import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type MediaPage } from '../../lib/api';

export const appQueryKeys = {
  categories: ['categories'] as const,
  mediaRoot: ['media'] as const,
  media: (categoryId: string) => ['media', categoryId] as const,
  queue: ['queue'] as const,
  runtimeConfig: ['runtime-config'] as const
};

export function useCategoriesQuery() {
  return useQuery({
    queryFn: api.categories,
    queryKey: appQueryKeys.categories
  });
}

export function useMediaQuery(categoryId: string) {
  return useInfiniteQuery({
    enabled: categoryId.length > 0,
    getNextPageParam: (lastPage: MediaPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.media(categoryId, pageParam),
    queryKey: appQueryKeys.media(categoryId)
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
