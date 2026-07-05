import { describe, it, expect } from 'bun:test';
import { createSveltePlugin } from './svelte-plugin';

const FILE = '/proj/src/Counter.svelte';

const DUAL = `<script module lang="ts">
export const shared = 'legacy';
</script>
<script lang="ts">
let count = 0;
function inc() { count += 1; }
</script>
<button onclick={inc}>{count} 🚀</button>
`;

describe('createSveltePlugin', () => {
  const plugin = createSveltePlugin();

  it('should own the .svelte extension', () => {
    expect(plugin.extensions).toEqual(['.svelte']);
  });

  it('should extract a single instance script block as parseable TS', () => {
    const raw = `<script lang="ts">\nconst msg: string = 'x';\n</script>\n<p>{msg}</p>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain("const msg: string = 'x';");
    expect(parseText).not.toContain('<p>');
  });

  it('should include BOTH module and instance blocks in raw order', () => {
    const { parseText } = plugin.transform(FILE, DUAL);

    expect(parseText).toContain("export const shared = 'legacy';");
    expect(parseText).toContain('function inc()');
    expect(parseText.indexOf('shared')).toBeLessThan(parseText.indexOf('inc'));
  });

  it('should map virtual offsets to exact raw offsets across both blocks (multibyte-safe)', () => {
    const { parseText, map } = plugin.transform(FILE, DUAL);

    for (const needle of ['shared', 'count = 0', 'inc()']) {
      const virtualIdx = parseText.indexOf(needle);
      const rawIdx = DUAL.indexOf(needle);
      expect(virtualIdx).toBeGreaterThanOrEqual(0);
      expect(map!.toRaw(virtualIdx)).toBe(rawIdx);
      expect(map!.toVirtual(rawIdx)).toBe(virtualIdx);
    }
  });

  it('should emit one virtual .ts file whose text equals the parse text', () => {
    const { parseText } = plugin.transform(FILE, DUAL);
    const virtuals = plugin.virtualFiles(FILE, DUAL);

    expect(virtuals).toEqual([{ path: `${FILE}.__svelte__.ts`, text: parseText }]);
  });

  it('should produce an empty module for a markup-only component', () => {
    const raw = `<p>static</p>\n`;
    const { parseText, map } = plugin.transform(FILE, raw);

    expect(parseText).toBe('export {};\n');
    expect(map!.toRaw(0)).toBeNull();
  });

  it('should bring generic type params into scope via a synthetic prelude', () => {
    const raw = `<script lang="ts" generics="T extends { id: string }">\nexport let item: T;\nexport const itemId = item.id;\n</script>\n`;
    const { parseText, map } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = { id: string };');
    expect(parseText).toContain('export let item: T;');
    // The synthetic prelude must NOT shift raw coordinates of real script code.
    const itemIdx = parseText.indexOf('item: T');
    expect(map!.toRaw(itemIdx)).toBe(raw.indexOf('item: T'));
  });

  it('should declare a bare generic param as unknown', () => {
    const raw = `<script lang="ts" generics="T, U extends string">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = unknown;');
    expect(parseText).toContain('type U = string;');
  });

  it('should split generics on top-level commas only (nested brackets preserved)', () => {
    const raw = `<script lang="ts" generics="T extends Record<string, number>">\nexport let m: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = Record<string, number>;');
  });

  it('should strip a Svelte 5 `const` type-parameter modifier from the alias name', () => {
    const raw = `<script lang="ts" generics="const T">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = unknown;');
    expect(parseText).not.toContain('type const');
  });

  it('should strip variance (`in`/`out`) modifiers from the alias name', () => {
    const raw = `<script lang="ts" generics="in T, out U">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = unknown;');
    expect(parseText).toContain('type U = unknown;');
    expect(parseText).not.toContain('type in');
    expect(parseText).not.toContain('type out');
  });

  it('should use the constraint (not the default) when a param has both `extends` and `=`', () => {
    const raw = `<script lang="ts" generics="T extends string = number">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = string;');
    expect(parseText).not.toContain('= string = number');
  });

  it('should detect `extends` across any whitespace (tab/newline), not just a literal space', () => {
    const raw = `<script lang="ts" generics="T\textends string">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = string;');
    expect(parseText).not.toContain('type T\textends');
  });

  it('should apply a bare default (no `extends`) as the alias body', () => {
    const raw = `<script lang="ts" generics="T = string">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = string;');
  });

  it('should treat `extends` inside a conditional-type DEFAULT as part of the default, not the constraint', () => {
    const raw = `<script lang="ts" generics="T = A extends B ? C : D">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    // The `extends` here belongs to the default's conditional type — the alias
    // body must be the whole conditional, not a mangled `A = B ? C : D`.
    expect(parseText).toContain('type T = A extends B ? C : D;');
    expect(parseText).not.toContain('type T = A =');
  });

  it('should handle a conditional-type default on a later param without breaking the list', () => {
    const raw = `<script lang="ts" generics="U, T = Foo extends Bar ? 1 : 2">\nexport let a: U;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type U = unknown;');
    expect(parseText).toContain('type T = Foo extends Bar ? 1 : 2;');
  });

  it('should keep the constraint when a param has both a constraint and a conditional-type default', () => {
    const raw = `<script lang="ts" generics="T extends X = A extends B ? C : D">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = X;');
  });

  it('should not split on commas inside string-literal constraints', () => {
    const raw = `<script lang="ts" generics="A extends 'x,y', B">\nexport let a: A;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain("type A = 'x,y';");
    expect(parseText).toContain('type B = unknown;');
  });

  it('should preserve an arrow (`=>`) in a constraint without treating it as a default `=`', () => {
    const raw = `<script lang="ts" generics="T extends () => void">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = () => void;');
  });

  it('should treat an escaped quote inside a string-literal constraint as literal content', () => {
    const raw = `<script lang="ts" generics="T extends 'a\\'b'">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    // The escaped quote must not terminate the string early nor split the param.
    expect(parseText).toContain("type T = 'a\\'b';");
    expect(parseText.match(/type /g)?.length).toBe(1);
  });

  it('should keep a template-literal-type constraint intact (inner commas are not top-level)', () => {
    const raw = `<script lang="ts" generics="T extends \`\${string},\${number}\`">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = `${string},${number}`;');
    expect(parseText.match(/type /g)?.length).toBe(1);
  });

  it('should emit no prelude for an empty or whitespace-only generics attribute', () => {
    for (const generics of ['', '   ']) {
      const raw = `<script lang="ts" generics="${generics}">\nexport let a: number;\n</script>\n`;
      const { parseText } = plugin.transform(FILE, raw);
      expect(parseText).not.toContain('type ');
      expect(parseText).toContain('export let a: number;');
    }
  });

  it('should ignore a trailing comma in the generics list', () => {
    const raw = `<script lang="ts" generics="T,">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain('type T = unknown;');
    expect(parseText.match(/type /g)?.length).toBe(1);
  });

  it('should not hang or split on an unterminated string-literal constraint', () => {
    const raw = `<script lang="ts" generics="T extends 'oops">\nexport let a: T;\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain("type T = 'oops");
    expect(parseText.match(/type /g)?.length).toBe(1);
  });

  it('should degrade to an empty module (not throw) when the component cannot be parsed', () => {
    // svelte.parse throws on malformed input; the plugin must degrade so the
    // semantic host's notifyFileChanged never crashes (parse-degrade philosophy).
    const malformed = `<script lang="ts">const a = `;
    expect(() => plugin.transform(FILE, malformed)).not.toThrow();
    expect(plugin.transform(FILE, malformed).parseText).toBe('export {};\n');
    expect(plugin.virtualFiles(FILE, malformed)[0]!.text).toBe('export {};\n');
  });
});
