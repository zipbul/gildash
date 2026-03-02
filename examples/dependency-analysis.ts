/**
 * Dependency graph analysis: detect circular imports and compute impact.
 *
 * Usage: bun run examples/dependency-analysis.ts <project-root>
 */
import { Gildash } from '../src/gildash';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: bun run examples/dependency-analysis.ts <project-root>');
  process.exit(1);
}

const g = await Gildash.open({ projectRoot, watchMode: false });

try {
  // Circular import detection
  const hasCycle = await g.hasCycle();
  console.log(`Circular imports detected: ${hasCycle}`);

  if (hasCycle) {
    const cycles = await g.getCyclePaths(undefined, { maxCycles: 5 });
    console.log(`\nFirst ${cycles.length} cycle(s):`);
    for (const cycle of cycles) {
      console.log(`  ${cycle.join(' → ')}`);
    }
  }

  // Import graph overview
  const graph = await g.getImportGraph();
  console.log(`\nImport graph: ${graph.size} modules\n`);

  // Pick the first file and show its dependency metrics
  const files = g.listIndexedFiles();
  if (files.length > 0) {
    const target = files[0]!.filePath;
    const fanMetrics = await g.getFanMetrics(target);
    const affected = await g.getAffected([target]);
    const deps = g.getDependencies(target);
    const dependents = g.getDependents(target);

    console.log(`File: ${target}`);
    console.log(`  Dependencies:  ${deps.length} (fan-out: ${fanMetrics.fanOut})`);
    console.log(`  Dependents:    ${dependents.length} (fan-in: ${fanMetrics.fanIn})`);
    console.log(`  Affected if changed: ${affected.length} files`);
  }
} finally {
  await g.close();
}
