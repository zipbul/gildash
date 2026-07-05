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
 * by the semantic host's virtual-file table, not by this plugin.
 */

import type { PositionMap } from './position-map';
import type { LanguagePlugin } from './types';
import { loadOptionalPeer } from './peer-loader';
import { buildVirtualModule, memoizeByRaw } from './virtual-module';

interface SvelteScriptBlock {
  content: { start: number; end: number };
  attributes: Array<{ name: string; value: unknown }>;
}

type SvelteParseFn = (source: string, options: { modern: true }) => {
  instance: SvelteScriptBlock | null;
  module: SvelteScriptBlock | null;
};

type ExtractResult = { parseText: string; map: PositionMap; lang: 'ts' | 'tsx' };

/** Read a script block string attribute value (e.g. `lang`, `generics`), if any. */
function blockAttribute(block: SvelteScriptBlock, name: string): string | undefined {
  const attribute = block.attributes.find((candidate) => candidate.name === name);
  if (!attribute || !Array.isArray(attribute.value)) return undefined;
  const first = attribute.value[0] as { data?: string } | undefined;
  return first?.data;
}

const OPENERS = new Set(['<', '{', '(', '[']);
const CLOSERS = new Set(['>', '}', ')', ']']);
/** TS type-parameter modifiers that precede the parameter name (`const T`, `in K`, `out V`). */
const PARAM_MODIFIERS = new Set(['const', 'in', 'out']);

/**
 * Advance past the string/template literal whose opening quote is at `start`
 * (handling backslash escapes); returns the index after its closing quote. The
 * whole literal — including any commas, brackets, or `extends` keywords inside a
 * string/template type — is consumed as one unit, so it never affects top-level
 * scanning.
 */
function skipLiteral(source: string, start: number): number {
  const quote = source[start]!;
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * Walk `source` at the top level, calling `visit(i, depth)` for every index that
 * is neither inside a string/template literal nor the interior of an arrow `=>`
 * (so a `>` from an arrow never miscounts bracket depth). Returning `true` stops
 * the walk. Bracket characters advance `depth` and are not visited.
 */
function scanTopLevel(source: string, visit: (index: number, depth: number) => boolean | void): void {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipLiteral(source, i);
      continue;
    }
    if (ch === '=' && source[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (OPENERS.has(ch)) depth++;
    else if (CLOSERS.has(ch)) depth--;
    else if (visit(i, depth)) return;
    i++;
  }
}

/** Split a type-parameter list on top-level commas (bracket- and literal-aware). */
function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  scanTopLevel(source, (i, depth) => {
    if (source[i] === ',' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  });
  parts.push(source.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const isWhitespace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/** Top-level `extends` keyword boundary (whitespace-delimited, outside brackets/literals), or null. */
function findExtends(param: string): { start: number; end: number } | null {
  let hit: { start: number; end: number } | null = null;
  scanTopLevel(param, (i, depth) => {
    if (
      depth === 0 &&
      param.startsWith('extends', i) &&
      isWhitespace(param[i - 1]) &&
      isWhitespace(param[i + 'extends'.length])
    ) {
      hit = { start: i, end: i + 'extends'.length };
      return true;
    }
  });
  return hit;
}

/**
 * Index of the top-level default separator `=` (never an arrow `=>`), or -1.
 * A type parameter's only top-level `=` is its default separator, so the first
 * top-level `=` bounds the name/constraint from the default.
 */
function findDefaultEquals(param: string): number {
  let equalsIndex = -1;
  scanTopLevel(param, (i, depth) => {
    if (depth === 0 && param[i] === '=') {
      equalsIndex = i;
      return true;
    }
  });
  return equalsIndex;
}

/** Drop leading `const`/`in`/`out` modifiers, keeping the parameter name. */
function stripModifiers(name: string): string {
  let tokens = name.trim().split(/\s+/);
  while (tokens.length > 1 && PARAM_MODIFIERS.has(tokens[0]!)) tokens = tokens.slice(1);
  return tokens.join(' ');
}

/**
 * Turn one Svelte type parameter into a virtual `type <name> = <body>` alias.
 * A constraint (`extends C`) becomes the body so members resolve; a bare default
 * (`= D`) is used when there is no constraint; an unconstrained param is
 * `unknown` (mirroring Svelte: it has no members). Modifiers and a trailing
 * default after a constraint are dropped — they are not valid in an alias body.
 */
function aliasFor(param: string): string {
  // Grammar: `[modifiers] Name [extends Constraint] [= Default]`. The default `=`
  // comes last, so bound it FIRST — a constraint `extends` can only live before
  // it. (An `extends` inside a conditional-type default lives after the `=` and
  // must NOT be mistaken for the parameter's constraint.)
  const eq = findDefaultEquals(param);
  const beforeDefault = eq >= 0 ? param.slice(0, eq) : param;
  const ext = findExtends(beforeDefault);
  const nameEnd = ext ? ext.start : eq >= 0 ? eq : param.length;
  const name = stripModifiers(param.slice(0, nameEnd));

  let body: string;
  if (ext) body = beforeDefault.slice(ext.end).trim();
  else if (eq >= 0) body = param.slice(eq + 1).trim();
  else body = 'unknown';
  return `type ${name} = ${body || 'unknown'};`;
}

/**
 * Svelte 5 `generics="..."` declares component type parameters on the tag —
 * outside the script content. Emit a synthetic type-alias prelude so those names
 * resolve in the virtual module. The prelude is unmapped, so real script
 * positions are intact.
 */
function genericsPrelude(generics: string): string {
  const declarations = splitTopLevel(generics).map(aliasFor);
  return declarations.length > 0 ? `${declarations.join('\n')}\n` : '';
}

export function createSveltePlugin(): LanguagePlugin {
  // Lazy: only consumers that create the plugin need the optional peer.
  const { parse } = loadOptionalPeer<{ parse: SvelteParseFn }>(
    'svelte/compiler',
    'Svelte',
    '"svelte" (>=5)',
  );

  // The pipeline calls `transform` (syntax side) and `virtualFiles` (semantic
  // side) with the same content — memoize so svelte.parse runs once per content
  // version, not twice.
  const extract = memoizeByRaw((raw: string): ExtractResult => {
    // svelte.parse throws on malformed input — degrade to an empty module so a
    // mid-edit component never crashes semantic notification (parse-degrade).
    let parsed: { instance: SvelteScriptBlock | null; module: SvelteScriptBlock | null };
    try {
      parsed = parse(raw, { modern: true });
    } catch {
      return { ...buildVirtualModule([]), lang: 'ts' };
    }
    const { instance, module } = parsed;
    const blocks = [module, instance]
      .filter((b): b is SvelteScriptBlock => b !== null && b !== undefined)
      .sort((a, b) => a.content.start - b.content.start);

    const lang = blocks.some((b) => blockAttribute(b, 'lang') === 'tsx' || blockAttribute(b, 'lang') === 'jsx') ? 'tsx' : 'ts';
    // Svelte 5 `generics="..."` are declared on the tag, outside the script — emit
    // a synthetic (unmapped) type-alias prelude so they resolve in the module.
    const generics = blocks.map((b) => blockAttribute(b, 'generics')).find((g): g is string => g !== undefined);
    const { parseText, map } = buildVirtualModule(
      blocks.map((b) => ({ rawStart: b.content.start, content: raw.slice(b.content.start, b.content.end) })),
      generics ? genericsPrelude(generics) : '',
    );
    return { parseText, map, lang };
  });

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
  };
}
