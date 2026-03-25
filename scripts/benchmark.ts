/**
 * CI benchmark script for gildash parse + extract performance.
 *
 * Parses all non-test .ts files in src/ using parseSource, runs extractSymbols
 * on each, measures timing across 10 iterations, and reports medians.
 *
 * Usage: bun scripts/benchmark.ts
 */
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource } from '../src/parser/index.ts';
import { extractSymbols } from '../src/extractor/index.ts';
import { isErr } from '@zipbul/result';
import type { ParsedFile } from '../src/parser/types.ts';

const ITERATIONS = 10;
const SRC_DIR = resolve(import.meta.dirname, '..', 'src');

function discoverSourceFiles(): string[] {
  const glob = new Glob('**/*.ts');
  const files: string[] = [];
  for (const match of glob.scanSync({ cwd: SRC_DIR, absolute: true })) {
    // Skip test files
    if (match.endsWith('.spec.ts') || match.endsWith('.test.ts')) continue;
    files.push(match);
  }
  return files.sort();
}

interface FileEntry {
  filePath: string;
  sourceText: string;
}

function loadFiles(filePaths: string[]): FileEntry[] {
  return filePaths.map(filePath => ({
    filePath,
    sourceText: readFileSync(filePath, 'utf-8'),
  }));
}

interface IterationResult {
  parseMs: number;
  extractMs: number;
  totalMs: number;
  symbolCount: number;
}

function runIteration(files: FileEntry[]): IterationResult {
  let totalParseMs = 0;
  let totalExtractMs = 0;
  let symbolCount = 0;

  for (const file of files) {
    const parseStart = performance.now();
    const result = parseSource(file.filePath, file.sourceText);
    const parseEnd = performance.now();
    totalParseMs += parseEnd - parseStart;

    if (isErr(result)) continue;

    const parsed = result as ParsedFile;
    const extractStart = performance.now();
    const symbols = extractSymbols(parsed);
    const extractEnd = performance.now();
    totalExtractMs += extractEnd - extractStart;

    symbolCount += symbols.length;
  }

  return {
    parseMs: totalParseMs,
    extractMs: totalExtractMs,
    totalMs: totalParseMs + totalExtractMs,
    symbolCount,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function main(): void {
  const filePaths = discoverSourceFiles();
  const files = loadFiles(filePaths);

  console.log(`=== Gildash Benchmark ===`);
  console.log(`Files: ${files.length}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log('');

  // Warmup run (not counted)
  runIteration(files);

  // Memory measurement: before/after a single full run
  const heapBefore = process.memoryUsage().heapUsed;
  const memRun = runIteration(files);
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = (heapAfter - heapBefore) / 1024 / 1024;

  // Timed iterations
  const results: IterationResult[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    results.push(runIteration(files));
  }

  const parseTimes = results.map(r => r.parseMs);
  const extractTimes = results.map(r => r.extractMs);
  const totalTimes = results.map(r => r.totalMs);

  const medianParse = median(parseTimes);
  const medianExtract = median(extractTimes);
  const medianTotal = median(totalTimes);
  const filesPerSec = Math.round(files.length / (medianTotal / 1000));

  console.log(`Parse (median): ${medianParse.toFixed(2)} ms`);
  console.log(`Extract (median): ${medianExtract.toFixed(2)} ms`);
  console.log(`Total (median): ${medianTotal.toFixed(2)} ms`);
  console.log(`Files/sec: ${filesPerSec}`);
  console.log('');

  // Per-file averages
  const avgParsePerFile = medianParse / files.length;
  const avgExtractPerFile = medianExtract / files.length;
  const avgTotalPerFile = medianTotal / files.length;
  console.log(`--- Per-file averages (median iteration) ---`);
  console.log(`Parse: ${avgParsePerFile.toFixed(3)} ms/file`);
  console.log(`Extract: ${avgExtractPerFile.toFixed(3)} ms/file`);
  console.log(`Total: ${avgTotalPerFile.toFixed(3)} ms/file`);
  console.log('');

  // Memory profiling
  console.log(`--- Memory Profile ---`);
  console.log(`Heap before: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap after:  ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Peak delta:  ${heapDeltaMb >= 0 ? '+' : ''}${heapDeltaMb.toFixed(2)} MB`);
  console.log(`Symbols extracted: ${memRun.symbolCount}`);
}

main();
