import type { ParsedFile } from './types';
import { LruCache } from '../common/lru-cache';

export class ParseCache {
  private readonly lru: LruCache<string, ParsedFile>;

  constructor(capacity: number = 500) {
    this.lru = new LruCache<string, ParsedFile>(capacity);
  }

  get(filePath: string): ParsedFile | undefined {
    return this.lru.get(filePath);
  }

  set(filePath: string, parsed: ParsedFile): void {
    this.lru.set(filePath, parsed);
  }

  invalidate(filePath: string): void {
    this.lru.delete(filePath);
  }

  invalidateAll(): void {
    this.lru.clear();
  }

  size(): number {
    return this.lru.size;
  }
}
