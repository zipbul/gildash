import { findInFiles, Lang } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';

/**
 * A captured metavariable from an ast-grep pattern match.
 */
export interface PatternCapture {
  /** Source text of the captured node. */
  text: string;
  /** 1-based start line number. */
  startLine: number;
  /** 1-based end line number. */
  endLine: number;
}

/**
 * A single structural-pattern match found in a source file.
 */
export interface PatternMatch {
  /** Absolute path of the file containing the match. */
  filePath: string;
  /** 1-based start line number of the matched node. */
  startLine: number;
  /** 1-based end line number of the matched node. */
  endLine: number;
  /** Source text of the matched node. */
  matchedText: string;
  /** Named captures from metavariables in the pattern (e.g. `$METHOD`, `$$$ARGS`). */
  captures?: Record<string, PatternCapture>;
}

/** Extract named metavariable identifiers from an ast-grep pattern string. */
function extractMetavariables(pattern: string): string[] {
  const seen = new Set<string>();
  // Match $$$NAME, $$NAME, or $NAME (uppercase identifiers)
  const re = /\${1,3}([A-Z_][A-Z_0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) {
    seen.add(m[0]!);
  }
  return [...seen];
}

/** Build captures record from an SgNode and a list of metavariable names. */
function buildCaptures(node: SgNode, metavars: string[]): Record<string, PatternCapture> | undefined {
  if (metavars.length === 0) return undefined;
  const captures: Record<string, PatternCapture> = {};
  let found = false;
  for (const mv of metavars) {
    // Try single-node capture first
    const single = node.getMatch(mv);
    if (single) {
      const r = single.range();
      captures[mv] = { text: single.text(), startLine: r.start.line + 1, endLine: r.end.line + 1 };
      found = true;
      continue;
    }
    // Try multi-node capture (for $$$ variadic metavariables)
    const multi = node.getMultipleMatches(mv);
    if (multi.length > 0) {
      const firstRange = multi[0]!.range();
      const lastRange = multi[multi.length - 1]!.range();
      captures[mv] = {
        text: multi.map((n) => n.text()).join(', '),
        startLine: firstRange.start.line + 1,
        endLine: lastRange.end.line + 1,
      };
      found = true;
    }
  }
  return found ? captures : undefined;
}

/**
 * Options for {@link patternSearch}.
 */
export interface PatternSearchOptions {
  /** An ast-grep structural pattern string (e.g. `'console.log($$$)'`). */
  pattern: string;
  /** Absolute file paths (or directories) to search within. */
  filePaths: string[];
}

/**
 * Search for a structural AST pattern across a set of TypeScript/TSX files
 * using ast-grep's `findInFiles` API.
 *
 * @param opts - Pattern and file paths to search.
 * @returns An array of {@link PatternMatch} entries for all matching nodes.
 */
export async function patternSearch(opts: PatternSearchOptions): Promise<PatternMatch[]> {
  if (opts.filePaths.length === 0) return [];

  const metavars = extractMetavariables(opts.pattern);
  const matches: PatternMatch[] = [];

  await findInFiles(
    Lang.TypeScript,
    {
      paths: opts.filePaths,
      matcher: { rule: { pattern: opts.pattern } },
    },
    (err, nodes) => {
      if (err) {
        console.warn('[patternSearch] findInFiles callback error:', err);
        return;
      }
      for (const node of nodes) {
        const r = node.range();
        const match: PatternMatch = {
          filePath: node.getRoot().filename(),
          startLine: r.start.line + 1,
          endLine: r.end.line + 1,
          matchedText: node.text(),
        };
        const captures = buildCaptures(node, metavars);
        if (captures) match.captures = captures;
        matches.push(match);
      }
    },
  );

  return matches;
}
