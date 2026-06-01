import type { GildashContext } from './context';
import type { AnnotationSearchQuery, AnnotationSearchResult } from '../search/annotation-search';
import { assertOpen, guard } from './guard';

export function searchAnnotations(
  ctx: GildashContext,
  query: AnnotationSearchQuery,
): AnnotationSearchResult[] {
  assertOpen(ctx);
  if (!ctx.annotationRepo || !ctx.annotationSearchFn) return [];

  const { annotationRepo, annotationSearchFn } = ctx;
  return guard(ctx, 'search', 'searchAnnotations', () =>
    annotationSearchFn({
      annotationRepo,
      project: query.project ?? ctx.defaultProject,
      query,
    }),
  );
}
