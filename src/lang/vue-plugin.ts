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
 * time with a clear error when missing. Module resolution of `./Foo.vue` imports
 * is owned by the semantic host's virtual-file table (content-aware), not by
 * this plugin.
 */

import type { PositionMap } from './position-map';
import type { LanguagePlugin } from './types';
import { loadOptionalPeer } from './peer-loader';
import { buildVirtualModule, memoizeByRaw } from './virtual-module';

type SfcParseFn = (source: string) => {
  descriptor: {
    script: { content: string; lang?: string; loc: { start: { offset: number } } } | null;
    scriptSetup: { content: string; lang?: string; loc: { start: { offset: number } } } | null;
  };
};

type ExtractResult = { parseText: string; map: PositionMap; lang: 'ts' | 'tsx' };

export function createVuePlugin(): LanguagePlugin {
  // Lazy: only consumers that create the plugin need the optional peer.
  const { parse } = loadOptionalPeer<{ parse: SfcParseFn }>(
    '@vue/compiler-sfc',
    'Vue',
    '"@vue/compiler-sfc" (>=3.4)',
  );

  // The pipeline calls `transform` (syntax side) and `virtualFiles` (semantic
  // side) with the same content — memoize so compiler-sfc runs once per content
  // version, not twice.
  const extract = memoizeByRaw((raw: string): ExtractResult => {
    const { descriptor } = parse(raw);
    const blocks = [descriptor.script, descriptor.scriptSetup]
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.loc.start.offset - b.loc.start.offset);

    const lang = blocks.some((b) => b.lang === 'tsx' || b.lang === 'jsx') ? 'tsx' : 'ts';
    const { parseText, map } = buildVirtualModule(
      blocks.map((b) => ({ rawStart: b.loc.start.offset, content: b.content })),
    );
    return { parseText, map, lang };
  });

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
  };
}
