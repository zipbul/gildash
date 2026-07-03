/**
 * svelte-plugin — Svelte component support for the language-plugin pipeline.
 *
 * Extracts `<script module>` / `<script>` blocks (in raw order) into one virtual
 * TS module. Each block is a contiguous slice of the raw file, so the
 * {@link PositionMap} is exact by construction. Virtual naming is the internal
 * `<file>.svelte.__svelte__.ts[x]` scheme (never a plausible sibling on disk);
 * the extension follows a block's `lang` (`tsx`/`jsx` → `.tsx`).
 *
 * `svelte` is an optional peer dependency — loaded lazily at factory time with a
 * clear error when missing. Module resolution of `./Foo.svelte` imports is owned
 * by the semantic host's virtual-file table, so `resolveModuleName` returns
 * `null`.
 */

import { GildashError } from '../errors';
import { PositionMap, type PositionSegment } from './position-map';
import type { LanguagePlugin } from './types';

interface SvelteScriptBlock {
  content: { start: number; end: number };
  attributes: Array<{ name: string; value: unknown }>;
}

type SvelteParseFn = (source: string, options: { modern: true }) => {
  instance: SvelteScriptBlock | null;
  module: SvelteScriptBlock | null;
};

/** Placeholder module body for components with no script block. */
const EMPTY_MODULE = 'export {};\n';

type ExtractResult = { parseText: string; map: PositionMap; lang: 'ts' | 'tsx' };

function loadSvelteParser(): SvelteParseFn {
  try {
    // Lazy: only consumers that create the plugin need the optional peer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const compiler = require('svelte/compiler') as { parse: SvelteParseFn };
    return compiler.parse;
  } catch (e) {
    throw new GildashError(
      'validation',
      'Gildash: the Svelte language plugin requires the optional peer dependency "svelte" (>=5)',
      { cause: e },
    );
  }
}

/** Read a script block string attribute value (e.g. `lang`, `generics`), if any. */
function blockAttr(block: SvelteScriptBlock, name: string): string | undefined {
  const attr = block.attributes.find((a) => a.name === name);
  if (!attr || !Array.isArray(attr.value)) return undefined;
  const first = attr.value[0] as { data?: string } | undefined;
  return first?.data;
}

/** Split a type-parameter list on top-level commas (bracket-depth aware). */
function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '<' || ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Top-level index of ` extends ` (outside any bracket), or -1. */
function topLevelExtends(param: string): number {
  let depth = 0;
  for (let i = 0; i < param.length; i++) {
    const ch = param[i]!;
    if (ch === '<' || ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === '}' || ch === ')' || ch === ']') depth--;
    else if (depth === 0 && param.startsWith(' extends ', i)) return i;
  }
  return -1;
}

/**
 * Svelte 5 `generics="..."` declares component type parameters on the tag —
 * outside the script content. Emit a synthetic type-alias prelude so those
 * names resolve in the virtual module (`T extends C` → `type T = C`, bare `T` →
 * `type T = unknown`, mirroring Svelte's own semantics: an unconstrained param
 * has no members). The prelude is unmapped, so real script positions are intact.
 */
function genericsPrelude(generics: string): string {
  const declarations = splitTopLevel(generics).map((param) => {
    const extIdx = topLevelExtends(param);
    if (extIdx >= 0) {
      return `type ${param.slice(0, extIdx).trim()} = ${param.slice(extIdx + ' extends '.length).trim()};`;
    }
    const eqIdx = param.indexOf('=');
    if (eqIdx >= 0) {
      return `type ${param.slice(0, eqIdx).trim()} = ${param.slice(eqIdx + 1).trim()};`;
    }
    return `type ${param} = unknown;`;
  });
  return declarations.length > 0 ? `${declarations.join('\n')}\n` : '';
}

export function createSveltePlugin(): LanguagePlugin {
  const parse = loadSvelteParser();

  let memo: { raw: string; result: ExtractResult } | null = null;

  function extract(raw: string): ExtractResult {
    if (memo?.raw === raw) return memo.result;
    const result = extractUncached(raw);
    memo = { raw, result };
    return result;
  }

  function extractUncached(raw: string): ExtractResult {
    // svelte.parse throws on malformed input — degrade to an empty module so a
    // mid-edit component never crashes semantic notification (parse-degrade).
    let parsed: { instance: SvelteScriptBlock | null; module: SvelteScriptBlock | null };
    try {
      parsed = parse(raw, { modern: true });
    } catch {
      return { parseText: EMPTY_MODULE, map: new PositionMap([]), lang: 'ts' };
    }
    const { instance, module } = parsed;
    const blocks = [module, instance]
      .filter((b): b is SvelteScriptBlock => b !== null && b !== undefined)
      .sort((a, b) => a.content.start - b.content.start);

    const lang = blocks.some((b) => blockAttr(b, 'lang') === 'tsx' || blockAttr(b, 'lang') === 'jsx') ? 'tsx' : 'ts';

    if (blocks.length === 0) {
      return { parseText: EMPTY_MODULE, map: new PositionMap([]), lang };
    }

    const generics = blocks.map((b) => blockAttr(b, 'generics')).find((g): g is string => g !== undefined);
    const segments: PositionSegment[] = [];
    // Synthetic, unmapped prelude — never contributes a PositionMap segment, so
    // real script positions still translate exactly.
    let parseText = generics ? genericsPrelude(generics) : '';
    for (const block of blocks) {
      if (parseText.length > 0) parseText += '\n';
      const content = raw.slice(block.content.start, block.content.end);
      segments.push({
        rawStart: block.content.start,
        virtualStart: parseText.length,
        length: content.length,
      });
      parseText += content;
    }
    return { parseText, map: new PositionMap(segments), lang };
  }

  return {
    extensions: ['.svelte'],

    transform(_filePath: string, raw: string) {
      const { parseText, map, lang } = extract(raw);
      return { parseText, map, lang };
    },

    virtualFiles(filePath: string, raw: string) {
      const { parseText, lang } = extract(raw);
      return [{ path: `${filePath}.__svelte__.${lang}`, text: parseText }];
    },

    resolveModuleName(): string | null {
      return null;
    },
  };
}
