import { describe, it, expect } from 'bun:test';
import { LanguagePluginRegistry } from './registry';
import type { LanguagePlugin } from './types';

function fakePlugin(extensions: string[]): LanguagePlugin {
  return {
    extensions,
    transform: (filePath, raw) => ({ parseText: raw, map: null }),
    virtualFiles: (filePath, raw) => [{ path: `${filePath}.__x__.ts`, text: raw }],
  };
}

describe('LanguagePluginRegistry', () => {
  it('should route a file to the plugin owning its extension', () => {
    const vue = fakePlugin(['.vue']);
    const registry = new LanguagePluginRegistry([vue]);

    expect(registry.pluginFor('/a/Foo.vue')).toBe(vue);
  });

  it('should return null for extensions no plugin owns (identity bypass)', () => {
    const registry = new LanguagePluginRegistry([fakePlugin(['.vue'])]);

    expect(registry.pluginFor('/a/b.ts')).toBeNull();
    expect(registry.pluginFor('/a/b.tsx')).toBeNull();
  });

  it('should return null from an empty registry', () => {
    const registry = new LanguagePluginRegistry([]);

    expect(registry.pluginFor('/a/Foo.vue')).toBeNull();
  });

  it('should reject two plugins claiming the same extension', () => {
    expect(() => new LanguagePluginRegistry([fakePlugin(['.vue']), fakePlugin(['.vue'])]))
      .toThrow();
  });

  it('should match extensions case-insensitively', () => {
    const registry = new LanguagePluginRegistry([fakePlugin(['.vue'])]);

    expect(registry.pluginFor('/a/Foo.VUE')).not.toBeNull();
  });
});
