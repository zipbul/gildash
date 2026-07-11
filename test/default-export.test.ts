import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Gildash } from '../src';

// ── Fixture project: default exports in every relevant form + a consumer ──────
const FILES: Record<string, string> = {
  'src/def-fn.ts': `export default function delay() { return 1; }`,
  'src/named.ts': `export function delay() { return 1; }`,
  'src/def-arrow.ts': `export default () => 3;`,
  'src/def-reexport.ts': `export { delay as default } from './named';`,
  'src/main.ts': `import delay from './def-fn';\ndelay();`,
};

let root: string;
let g: Gildash;
const abs = (rel: string) => join(root, rel);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gildash-defexp-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'defexp', version: '1.0.0' }));
  for (const [rel, content] of Object.entries(FILES)) {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  g = await Gildash.open({ projectRoot: root, extensions: ['.ts'], watchMode: false } as any);
});

afterAll(async () => {
  await g?.close({ cleanup: true }).catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('default export isDefault surfacing', () => {
  it('should distinguish a default-exported symbol from an identically-named named export', () => {
    const defSym = g.searchSymbols({ filePath: abs('src/def-fn.ts') } as any).find((s) => s.name === 'delay');
    const namedSym = g.searchSymbols({ filePath: abs('src/named.ts') } as any).find((s) => s.name === 'delay');

    expect(defSym?.detail.isDefault).toBe(true);
    expect(namedSym?.detail.isDefault).toBeUndefined();
  });

  it('should expose isDefault on the default export item of getModuleInterface and omit it on named exports', () => {
    const defExport = g.getModuleInterface(abs('src/def-fn.ts')).exports.find((e) => e.name === 'delay');
    const namedExport = g.getModuleInterface(abs('src/named.ts')).exports.find((e) => e.name === 'delay');

    expect(defExport?.isDefault).toBe(true);
    expect(namedExport?.isDefault).toBeUndefined();
  });

  it('should carry isDefault through getSymbolsByFile and getFullSymbol', () => {
    const bySym = g.getSymbolsByFile(abs('src/def-fn.ts')).find((s) => s.name === 'delay');
    const full = g.getFullSymbol('delay', abs('src/def-fn.ts'));

    expect(bySym?.detail.isDefault).toBe(true);
    expect(full?.isDefault).toBe(true);
  });

  it('should resolve resolveSymbol("default") to the local default definition and still follow sourced re-exports', () => {
    const local = g.resolveSymbol('default', abs('src/def-fn.ts'));
    const reexport = g.resolveSymbol('default', abs('src/def-reexport.ts'));

    expect(local.originalName).toBe('delay');
    expect(reexport.originalName).toBe('delay');
    expect(reexport.originalFilePath).toContain('named.ts');
  });

  it('should expose an exported "default" symbol for an arrow-function default (no longer invisible)', () => {
    const iface = g.getModuleInterface(abs('src/def-arrow.ts'));
    const def = iface.exports.find((e) => e.name === 'default');

    expect(def).toBeDefined();
    expect(def!.kind).toBe('function');
    expect(def!.isDefault).toBe(true);
  });

  it('should let a default import edge be joined to the default export symbol', () => {
    const importEdge = g.searchRelations({ type: 'imports', srcFilePath: abs('src/main.ts') } as any)
      .find((r) => r.dstFilePath?.endsWith('def-fn.ts'));
    const defExportName = g.getModuleInterface(abs('src/def-fn.ts')).exports.find((e) => e.isDefault)?.name;

    // Consumer edge points at "default"; the export symbol carrying isDefault names the local def.
    expect(importEdge?.dstSymbolName).toBe('default');
    expect(defExportName).toBe('delay');
  });
});
