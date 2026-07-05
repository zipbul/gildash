/**
 * peer-loader — lazy loading of a language plugin's optional peer dependency.
 *
 * Framework parsers (`@vue/compiler-sfc`, `svelte/compiler`) are optional peers:
 * only a consumer that creates the plugin needs them. This resolves one at factory
 * time and, when absent, throws a clear {@link GildashError} naming the package to
 * install — instead of an opaque `MODULE_NOT_FOUND`.
 */

import { GildashError } from '../errors';

/**
 * `require` the optional peer `moduleName`, or throw a validation error naming the
 * plugin and the package to install.
 *
 * @param pluginName - Human label for the plugin (e.g. `'Vue'`, `'Svelte'`).
 * @param peerDescription - The package + range as shown to the user (e.g.
 *   `'"@vue/compiler-sfc" (>=3.4)'`).
 */
export function loadOptionalPeer<T>(moduleName: string, pluginName: string, peerDescription: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(moduleName) as T;
  } catch (cause) {
    throw new GildashError(
      'validation',
      `Gildash: the ${pluginName} language plugin requires the optional peer dependency ${peerDescription}`,
      { cause },
    );
  }
}
