import type { Program, Comment, OxcError } from 'oxc-parser';

export interface SourcePosition {
  /** 1-based line number. */
  line: number;
  /** 0-based column number. */
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface ParsedFile {
  filePath: string;
  /** oxc-parser AST root node. */
  program: Program;
  /** Parse errors (file may be partially parsed). */
  errors: readonly OxcError[];
  /** All comments from the source. */
  comments: readonly Comment[];
  /** Original source text. Needed for offset→position. */
  sourceText: string;
}
