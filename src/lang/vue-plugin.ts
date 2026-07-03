/**
 * vue-plugin — Vue SFC support for the language-plugin pipeline.
 *
 * Extracts `<script>` / `<script setup>` blocks (in raw order) into one virtual
 * TS module. Each block is a contiguous slice of the raw file, so the
 * {@link PositionMap} is exact by construction. Virtual naming is the internal
 * `<file>.vue.__sfc__.ts[x]` scheme (never a plausible sibling on disk); the
 * extension follows the blocks' `lang` (`tsx`/`jsx` → `.tsx`).
 *
 * `@vue/compiler-sfc` is an optional peer dependency — loaded lazily at factory
 * time with a clear error when missing. Module resolution of `./Foo.vue`
 * imports is owned by the semantic host's virtual-file table (content-aware),
 * not by this plugin, so `resolveModuleName` always returns `null`.
 */

import { GildashError } from '../errors';
import { PositionMap, type PositionSegment } from './position-map';
import type { LanguagePlugin } from './types';

type SfcParseFn = (source: string) => {
  descriptor: {
    script: { content: string; lang?: string; loc: { start: { offset: number } } } | null;
    scriptSetup: { content: string; lang?: string; loc: { start: { offset: number } } } | null;
  };
};

/** Placeholder module body for SFCs with no script block. */
const EMPTY_MODULE = 'export {};\n';

type ExtractResult = { parseText: string; map: PositionMap; lang: 'ts' | 'tsx' };

function loadSfcParser(): SfcParseFn {
  try {
    // Lazy: only consumers that create the plugin need the optional peer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const compiler = require('@vue/compiler-sfc') as { parse: SfcParseFn };
    return compiler.parse;
  } catch (e) {
    throw new GildashError(
      'validation',
      'Gildash: the Vue language plugin requires the optional peer dependency "@vue/compiler-sfc" (>=3.4)',
      { cause: e },
    );
  }
}

export function createVuePlugin(): LanguagePlugin {
  const parse = loadSfcParser();

  // The pipeline calls `transform` (syntax side) and `virtualFiles` (semantic
  // side) with the same content — memoize the last extraction so compiler-sfc
  // runs once per content version, not twice.
  let memo: { raw: string; result: ExtractResult } | null = null;

  function extract(raw: string): ExtractResult {
    if (memo?.raw === raw) return memo.result;
    const result = extractUncached(raw);
    memo = { raw, result };
    return result;
  }

  function extractUncached(raw: string): ExtractResult {
    const { descriptor } = parse(raw);
    const blocks = [descriptor.script, descriptor.scriptSetup]
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.loc.start.offset - b.loc.start.offset);

    const lang = blocks.some((b) => b.lang === 'tsx' || b.lang === 'jsx') ? 'tsx' : 'ts';

    if (blocks.length === 0) {
      return { parseText: EMPTY_MODULE, map: new PositionMap([]), lang };
    }

    const segments: PositionSegment[] = [];
    let parseText = '';
    for (const block of blocks) {
      if (parseText.length > 0) parseText += '\n';
      segments.push({
        rawStart: block.loc.start.offset,
        virtualStart: parseText.length,
        length: block.content.length,
      });
      parseText += block.content;
    }
    return { parseText, map: new PositionMap(segments), lang };
  }

  return {
    extensions: ['.vue'],

    transform(_filePath: string, raw: string) {
      const { parseText, map, lang } = extract(raw);
      return { parseText, map, lang };
    },

    virtualFiles(filePath: string, raw: string) {
      const { parseText, lang } = extract(raw);
      return [{ path: `${filePath}.__sfc__.${lang}`, text: parseText }];
    },

    resolveModuleName(): string | null {
      // The semantic host resolves `./Foo.vue` via its registered virtual-file
      // table (the correct extension depends on the target file's content).
      return null;
    },
  };
}
