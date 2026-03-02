/**
 * Semantic analysis: resolve types and find references using tsc TypeChecker.
 *
 * Usage: bun run examples/semantic-analysis.ts <project-root>
 *
 * Note: Requires the `semantic: true` option, which enables tsc integration.
 */
import { Gildash } from '../src/gildash';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: bun run examples/semantic-analysis.ts <project-root>');
  process.exit(1);
}

const g = await Gildash.open({ projectRoot, watchMode: false, semantic: true });

try {
  const stats = g.getStats();
  console.log(`Indexed ${stats.fileCount} files with semantic analysis enabled\n`);

  // Show semantic module interface for the first file
  const files = g.listIndexedFiles();
  if (files.length > 0) {
    const target = files[0]!.filePath;
    console.log(`Semantic module interface for: ${target}\n`);

    const moduleInterface = g.getSemanticModuleInterface(target);
    for (const exp of moduleInterface.exports) {
      const typeStr = exp.resolvedType?.text ?? 'unknown';
      console.log(`  export ${exp.kind} ${exp.name}: ${typeStr}`);
    }

    // Find symbols and resolve their types
    const symbols = g.getSymbolsByFile(target);
    if (symbols.length > 0) {
      const sym = symbols[0]!;
      console.log(`\nResolving type for: ${sym.name}`);

      const resolved = g.getResolvedType(sym.name, target);
      if (resolved) {
        console.log(`  Type: ${resolved.text}`);
        console.log(`  Union: ${resolved.isUnion}, Intersection: ${resolved.isIntersection}`);
      }

      const refs = g.getSemanticReferences(sym.name, target);
      console.log(`  References: ${refs.length} locations`);
      for (const ref of refs.slice(0, 5)) {
        console.log(`    ${ref.filePath}:${ref.line}`);
      }
    }
  }
} finally {
  await g.close();
}
