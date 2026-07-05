import { describe, it, expect } from 'bun:test';
import { GildashError } from '../errors';
import { loadOptionalPeer } from './peer-loader';

describe('loadOptionalPeer', () => {
  it('should return the module when the optional peer is installed', () => {
    const mod = loadOptionalPeer<typeof import('node:path')>('node:path', 'Test', '"node:path"');

    expect(typeof mod.join).toBe('function');
  });

  it('should throw a GildashError naming the plugin and peer when the module is missing', () => {
    const attempt = () =>
      loadOptionalPeer('@zipbul/this-peer-does-not-exist', 'Vue', '"@vue/compiler-sfc" (>=3.4)');

    expect(attempt).toThrow(GildashError);
    expect(attempt).toThrow(/Vue language plugin requires the optional peer dependency "@vue\/compiler-sfc" \(>=3\.4\)/);
  });

  it('should preserve the underlying load error as the cause', () => {
    try {
      loadOptionalPeer('@zipbul/this-peer-does-not-exist', 'Svelte', '"svelte" (>=5)');
      throw new Error('expected loadOptionalPeer to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).cause).toBeDefined();
    }
  });
});
