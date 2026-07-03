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

  it('should not define plugin-level module resolution (host virtual table owns it)', () => {
    expect(plugin.resolveModuleName('./Counter.svelte', '/proj/src/app.ts')).toBeNull();
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

  it('should degrade to an empty module (not throw) when the component cannot be parsed', () => {
    // svelte.parse throws on malformed input; the plugin must degrade so the
    // semantic host's notifyFileChanged never crashes (parse-degrade philosophy).
    const malformed = `<script lang="ts">const a = `;
    expect(() => plugin.transform(FILE, malformed)).not.toThrow();
    expect(plugin.transform(FILE, malformed).parseText).toBe('export {};\n');
    expect(plugin.virtualFiles(FILE, malformed)[0]!.text).toBe('export {};\n');
  });
});
