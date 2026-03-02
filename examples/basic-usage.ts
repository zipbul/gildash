/**
 * Basic gildash usage: index a TypeScript project and search for symbols.
 *
 * Usage: bun run examples/basic-usage.ts <project-root>
 */
import { Gildash } from '../src/gildash';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: bun run examples/basic-usage.ts <project-root>');
  process.exit(1);
}

const g = await Gildash.open({ projectRoot, watchMode: false });

try {
  const stats = g.getStats();
  console.log(`Indexed ${stats.fileCount} files, ${stats.symbolCount} symbols\n`);

  // Search symbols
  const results = g.searchSymbols({ text: 'export' });
  console.log(`Found ${results.length} symbols matching "export":`);
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.kind} ${r.name} — ${r.filePath}:${r.span.start.line}`);
  }

  // List indexed files
  const files = g.listIndexedFiles();
  console.log(`\nIndexed files (first 10):`);
  for (const f of files.slice(0, 10)) {
    console.log(`  ${f.filePath}`);
  }
} finally {
  await g.close();
}
