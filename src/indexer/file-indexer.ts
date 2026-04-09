import { join } from 'node:path';
import { hashString } from '../common/hasher';
import { normalizePath } from '../common/path-utils';

export interface FileChangeRecord {
  filePath: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
}

export interface DetectChangesResult {
  changed: FileChangeRecord[];
  unchanged: FileChangeRecord[];
  deleted: string[];
}

interface FileRepoPart {
  getFilesMap(): Map<string, { filePath: string; mtimeMs: number; size: number; contentHash: string }>;
}

export type ScanFilesFn = (projectRoot: string, extensions: string[]) => AsyncIterable<string>;

function defaultScanFiles(projectRoot: string, extensions: string[]): AsyncIterable<string> {
  const extPattern = extensions.length === 1
    ? `**/*${extensions[0]}`
    : `**/*{${extensions.join(',')}}`;
  return new Bun.Glob(extPattern).scan({ cwd: projectRoot, followSymlinks: false });
}

export interface DetectChangesOptions {
  projectRoot: string;
  extensions: string[];
  ignorePatterns: string[];
  fileRepo: FileRepoPart;
  scanFilesFn?: ScanFilesFn;
}

export async function detectChanges(opts: DetectChangesOptions): Promise<DetectChangesResult> {
  const { projectRoot, extensions, ignorePatterns, fileRepo, scanFilesFn = defaultScanFiles } = opts;

  const existingMap = fileRepo.getFilesMap();
  const seenPaths = new Set<string>();
  const changed: FileChangeRecord[] = [];
  const unchanged: FileChangeRecord[] = [];

  const ignoreGlobs = ignorePatterns.map((p) => new Bun.Glob(p));

  for await (const rawRelativePath of scanFilesFn(projectRoot, extensions)) {
    const relativePath = normalizePath(rawRelativePath);
    if (!extensions.some((ext) => relativePath.endsWith(ext))) continue;

    if (relativePath.startsWith('node_modules/') || relativePath.includes('/node_modules/')) continue;

    if (ignoreGlobs.some((g) => g.match(relativePath))) continue;

    seenPaths.add(relativePath);

    const absPath = join(projectRoot, relativePath);
    const bunFile = Bun.file(absPath);
    const { size, lastModified: mtimeMs } = bunFile;

    const existing = existingMap.get(relativePath);

    if (!existing) {
      const text = await bunFile.text();
      const contentHash = hashString(text);
      changed.push({ filePath: relativePath, contentHash, mtimeMs, size });
      continue;
    }

    if (existing.mtimeMs === mtimeMs && existing.size === size) {
      unchanged.push({ filePath: relativePath, contentHash: existing.contentHash, mtimeMs, size });
      continue;
    }

    const text = await bunFile.text();
    const contentHash = hashString(text);
    if (contentHash === existing.contentHash) {
      unchanged.push({ filePath: relativePath, contentHash, mtimeMs, size });
    } else {
      changed.push({ filePath: relativePath, contentHash, mtimeMs, size });
    }
  }

  const deleted: string[] = [];
  for (const filePath of existingMap.keys()) {
    if (!seenPaths.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return { changed, unchanged, deleted };
}
