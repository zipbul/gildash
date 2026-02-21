import type { Program, Comment, OxcError } from 'oxc-parser';

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface ParsedFile {
  filePath: string;
  program: Program;
  errors: readonly OxcError[];
  comments: readonly Comment[];
  sourceText: string;
}
