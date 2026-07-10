import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

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
  return useQuery({
    enabled: categoryId.length > 0,
    queryFn: () => api.media(categoryId),
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
