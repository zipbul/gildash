import { describe, it, expect } from 'bun:test';
import { createVuePlugin } from './vue-plugin';

const FILE = '/proj/src/Counter.vue';

const DUAL_SFC = `<template>
  <button @click="inc">{{ count }} 🚀</button>
</template>
<script lang="ts">
export const shared = 'legacy';
</script>
<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
function inc() { count.value++; }
</script>
`;

describe('createVuePlugin', () => {
  const plugin = createVuePlugin();

  it('should own the .vue extension', () => {
    expect(plugin.extensions).toEqual(['.vue']);
  });

  it('should extract a single script setup block as parseable TS', () => {
    const raw = `<template><p>hi</p></template>\n<script setup lang="ts">\nconst msg: string = 'x';\n</script>\n`;
    const { parseText } = plugin.transform(FILE, raw);

    expect(parseText).toContain("const msg: string = 'x';");
    expect(parseText).not.toContain('<template>');
  });

  it('should include BOTH script blocks in raw order for a dual-script SFC', () => {
    const { parseText } = plugin.transform(FILE, DUAL_SFC);

    expect(parseText).toContain("export const shared = 'legacy';");
    expect(parseText).toContain('const count = ref(0);');
    expect(parseText.indexOf('shared')).toBeLessThan(parseText.indexOf('count'));
  });

  it('should map virtual offsets back to exact raw offsets across both blocks (multibyte-safe)', () => {
    const { parseText, map } = plugin.transform(FILE, DUAL_SFC);

    for (const needle of ['shared', 'count = ref', 'inc()']) {
      const virtualIdx = parseText.indexOf(needle);
      const rawIdx = DUAL_SFC.indexOf(needle);
      expect(virtualIdx).toBeGreaterThanOrEqual(0);
      expect(map!.toRaw(virtualIdx)).toBe(rawIdx);
      expect(map!.toVirtual(rawIdx)).toBe(virtualIdx);
    }
  });

  it('should emit one virtual .ts file whose text equals the parse text', () => {
    const { parseText } = plugin.transform(FILE, DUAL_SFC);
    const virtuals = plugin.virtualFiles(FILE, DUAL_SFC);

    expect(virtuals).toEqual([{ path: `${FILE}.__sfc__.ts`, text: parseText }]);
  });

  it('should emit a .tsx virtual file when a script block uses lang="tsx"', () => {
    const raw = `<script setup lang="tsx">\nconst node = <div />;\n</script>\n`;
    const virtuals = plugin.virtualFiles(FILE, raw);

    expect(virtuals[0]!.path).toBe(`${FILE}.__sfc__.tsx`);
  });

  it('should produce an empty module for a template-only SFC', () => {
    const raw = `<template><p>static</p></template>\n`;
    const { parseText, map } = plugin.transform(FILE, raw);
    const virtuals = plugin.virtualFiles(FILE, raw);

    expect(parseText).toBe('export {};\n');
    expect(map!.toRaw(0)).toBeNull();
    expect(virtuals[0]!.text).toBe('export {};\n');
  });

  it('should not define plugin-level module resolution (host virtual table owns it)', () => {
    expect(plugin.resolveModuleName('./Counter.vue', '/proj/src/app.ts')).toBeNull();
  });
});

describe('createVuePlugin — parser dialect', () => {
  const plugin = createVuePlugin();

  it('should report ts for lang="ts" script blocks', () => {
    expect(plugin.transform(FILE, DUAL_SFC).lang).toBe('ts');
  });

  it('should report tsx when a block uses lang="tsx"', () => {
    const raw = `<script setup lang="tsx">\nconst n = <div />;\n</script>\n`;
    expect(plugin.transform(FILE, raw).lang).toBe('tsx');
  });
});
