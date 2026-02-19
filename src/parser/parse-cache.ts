import type { ParsedFile } from './types';
import { LruCache } from '../common/lru-cache';

/**
 * In-process LRU cache for parsed ASTs.
 * Watcher integration should call invalidate() or invalidateAll() on file changes.
 */
export class ParseCache {
  private readonly lru: LruCache<string, ParsedFile>;

  constructor(capacity: number = 500) {
    this.lru = new LruCache<string, ParsedFile>(capacity);
  }

  /**
   * Retrieves a cached ParsedFile for the given file path.
   */
  get(filePath: string): ParsedFile | undefined {
    return this.lru.get(filePath);
  }

  /**
   * Stores a ParsedFile in the cache.
   */
  set(filePath: string, parsed: ParsedFile): void {
    this.lru.set(filePath, parsed);
  }

  /**
   * Removes a single file from the cache.
   */
  invalidate(filePath: string): void {
    this.lru.delete(filePath);
  }

  /**
   * Clears the entire cache.
   */
  invalidateAll(): void {
    this.lru.clear();
  }

  /**
   * Returns the current number of cached entries.
   */
  size(): number {
    return this.lru.size;
  }
}
