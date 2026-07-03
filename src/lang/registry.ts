import path from 'node:path';
import type { LanguagePlugin } from './types';

/**
 * Routes files and import specifiers to the {@link LanguagePlugin} owning their
 * extension. TS-family files have no plugin — `pluginFor` returns `null` and
 * the pipeline bypasses transformation entirely (zero overhead on the majority
 * path). Extension ownership is exclusive and case-insensitive.
 */
export class LanguagePluginRegistry {
  readonly #byExtension = new Map<string, LanguagePlugin>();

  constructor(plugins: LanguagePlugin[]) {
    for (const plugin of plugins) {
      for (const ext of plugin.extensions) {
        const key = ext.toLowerCase();
        if (this.#byExtension.has(key)) {
          throw new Error(`LanguagePluginRegistry: extension "${key}" claimed by two plugins`);
        }
        this.#byExtension.set(key, plugin);
      }
    }
  }

  /** The plugin owning `filePath`'s extension, or `null` (identity bypass). */
  pluginFor(filePath: string): LanguagePlugin | null {
    return this.#byExtension.get(path.extname(filePath).toLowerCase()) ?? null;
  }

  /** Resolve a specifier through the plugin owning ITS extension, if any. */
  resolveModuleName(specifier: string, containingFile: string): string | null {
    const plugin = this.#byExtension.get(path.extname(specifier).toLowerCase());
    return plugin?.resolveModuleName(specifier, containingFile) ?? null;
  }
}
