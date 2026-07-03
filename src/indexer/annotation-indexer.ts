import type { ParsedFile, SourceSpan } from '../parser/types';
import type { AnnotationSource } from '../extractor/types';
import { extractAnnotations } from '../extractor/annotation-extractor';
import type { AnnotationRepository } from '../store/repositories/annotation.repository';

interface AnnotationRepoPart {
  deleteFileAnnotations(project: string, filePath: string): void;
  insertBatch(
    project: string,
    filePath: string,
    rows: ReadonlyArray<{
      project: string;
      filePath: string;
      tag: string;
      value: string;
      source: AnnotationSource;
      symbolName: string | null;
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      indexedAt: string;
    }>,
  ): void;
}

export interface IndexFileAnnotationsOptions {
  parsed: ParsedFile;
  project: string;
  filePath: string;
  annotationRepo: AnnotationRepoPart;
  /**
   * Virtual→raw span translation for plugin-transformed files (position
   * invariant: the DB holds raw coordinates). Annotations whose span cannot be
   * remapped are skipped, never stored approximately.
   */
  remapSpan?: (span: SourceSpan) => SourceSpan | null;
}

export function indexFileAnnotations(opts: IndexFileAnnotationsOptions): number {
  const { parsed, project, filePath, annotationRepo, remapSpan } = opts;

  const extracted = extractAnnotations(parsed);

  annotationRepo.deleteFileAnnotations(project, filePath);

  const now = new Date().toISOString();
  const rows = extracted.flatMap((a) => {
    const span = remapSpan ? remapSpan(a.span) : a.span;
    if (!span) return [];
    return [{
      project,
      filePath,
      tag: a.tag,
      value: a.value,
      source: a.source,
      symbolName: a.symbolName,
      startLine: span.start.line,
      startColumn: span.start.column,
      endLine: span.end.line,
      endColumn: span.end.column,
      indexedAt: now,
    }];
  });

  if (!rows.length) return 0;
  annotationRepo.insertBatch(project, filePath, rows);
  return rows.length;
}
