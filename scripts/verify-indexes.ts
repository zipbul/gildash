/**
 * SQLite index optimization verification script.
 *
 * Creates a temporary gildash database with test data, runs the most common
 * query patterns via EXPLAIN QUERY PLAN, and reports whether each query
 * uses an index or falls back to a full table scan.
 *
 * Usage: bun scripts/verify-indexes.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Gildash } from '../src/gildash/index.ts';
import { Database } from 'bun:sqlite';
import { DATA_DIR, DB_FILE } from '../src/constants.ts';

interface QueryPlan {
  name: string;
  description: string;
  sql: string;
  expectedIndex: string;
  usesIndex: boolean;
  planDetail: string;
}

async function createTestDatabase(): Promise<{ projectRoot: string; gildash: Gildash }> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'gildash-verify-idx-'));
  const srcDir = join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'verify-idx-project' }));

  // Generate test files with varied symbols and relations
  const fileCount = 50;
  for (let i = 0; i < fileCount; i++) {
    const imports = i > 0 ? `import { value_${i - 1} } from './file_${i - 1}';\n` : '';
    const reExport = i > 2 ? `export { value_${i - 2} } from './file_${i - 2}';\n` : '';
    const content = [
      imports,
      reExport,
      `export const value_${i} = ${i};`,
      `export function fn_${i}(x: number): number { return x + ${i}; }`,
      `export class Cls_${i} { method_${i}() { return ${i}; } }`,
      `export interface IFace_${i} { prop_${i}: string; }`,
      `export type Type_${i} = { field_${i}: number };`,
      `const internal_${i} = 'not exported';`,
    ].join('\n');
    await writeFile(join(srcDir, `file_${i}.ts`), content);
  }

  const g = await Gildash.open({ projectRoot: tmpDir, watchMode: false });
  return { projectRoot: tmpDir, gildash: g };
}

function runExplainQueryPlan(dbPath: string, queries: Array<Omit<QueryPlan, 'usesIndex' | 'planDetail'>>): QueryPlan[] {
  const db = new Database(dbPath, { readonly: true });
  const results: QueryPlan[] = [];

  for (const q of queries) {
    try {
      const rows = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all() as Array<{
        id: number;
        parent: number;
        notused: number;
        detail: string;
      }>;
      const planDetail = rows.map(r => r.detail).join(' | ');
      const usesIndex = !planDetail.includes('SCAN') || planDetail.includes('USING INDEX') || planDetail.includes('USING COVERING INDEX');
      results.push({ ...q, usesIndex, planDetail });
    } catch (e) {
      results.push({
        ...q,
        usesIndex: false,
        planDetail: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  db.close();
  return results;
}

async function main(): Promise<void> {
  console.log('=== Gildash SQLite Index Verification ===\n');
  console.log('Creating temporary database with test data...');

  const { projectRoot, gildash } = await createTestDatabase();

  const stats = gildash.getStats();
  console.log(`Database populated: ${stats.fileCount} files, ${stats.symbolCount} symbols\n`);

  const project = gildash.projects[0]?.project ?? 'verify-idx-project';
  const dbPath = join(projectRoot, DATA_DIR, DB_FILE);

  const queries: Array<Omit<QueryPlan, 'usesIndex' | 'planDetail'>> = [
    {
      name: 'searchSymbols({ isExported: true })',
      description: 'Filter exported symbols for a project',
      sql: `SELECT * FROM symbols WHERE project = '${project}' AND is_exported = 1`,
      expectedIndex: 'idx_symbols_project_kind or idx_symbols_project_name (partial)',
    },
    {
      name: 'searchSymbols({ kind: "function" })',
      description: 'Filter symbols by kind for a project',
      sql: `SELECT * FROM symbols WHERE project = '${project}' AND kind = 'function'`,
      expectedIndex: 'idx_symbols_project_kind',
    },
    {
      name: 'searchRelations({ type: "imports" })',
      description: 'Filter relations by type for a project',
      sql: `SELECT * FROM relations WHERE project = '${project}' AND type = 'imports'`,
      expectedIndex: 'idx_relations_project_type_src or idx_relations_type',
    },
    {
      name: 'searchRelations({ type: "re-exports" })',
      description: 'Filter re-export relations for a project',
      sql: `SELECT * FROM relations WHERE project = '${project}' AND type = 're-exports'`,
      expectedIndex: 'idx_relations_project_type_src or idx_relations_type',
    },
    {
      name: 'searchSymbols({ text: "foo", exact: true })',
      description: 'Exact name match for a project',
      sql: `SELECT * FROM symbols WHERE project = '${project}' AND name = 'fn_1'`,
      expectedIndex: 'idx_symbols_project_name',
    },
    {
      name: 'searchSymbols({ text: "fn" }) via FTS',
      description: 'Full-text search on symbol name',
      sql: `SELECT * FROM symbols WHERE id IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH 'fn*') AND project = '${project}'`,
      expectedIndex: 'symbols_fts (FTS5)',
    },
    {
      name: 'getFileSymbols(project, filePath)',
      description: 'Retrieve all symbols for a specific file',
      sql: `SELECT * FROM symbols WHERE project = '${project}' AND file_path = 'src/file_0.ts'`,
      expectedIndex: 'idx_symbols_project_file',
    },
    {
      name: 'getOutgoing(project, srcFilePath)',
      description: 'Retrieve outgoing relations for a file',
      sql: `SELECT * FROM relations WHERE project = '${project}' AND src_file_path = 'src/file_1.ts'`,
      expectedIndex: 'idx_relations_src or idx_relations_project_type_src',
    },
    {
      name: 'getIncoming(dstProject, dstFilePath)',
      description: 'Retrieve incoming relations for a file',
      sql: `SELECT * FROM relations WHERE dst_project = '${project}' AND dst_file_path = 'src/file_0.ts'`,
      expectedIndex: 'idx_relations_dst',
    },
    {
      name: 'searchRelations({ specifier })',
      description: 'Filter relations by import specifier',
      sql: `SELECT * FROM relations WHERE project = '${project}' AND specifier = './file_0'`,
      expectedIndex: 'idx_relations_specifier',
    },
    {
      name: 'getByFingerprint(project, fingerprint)',
      description: 'Look up symbols by fingerprint',
      sql: `SELECT * FROM symbols WHERE project = '${project}' AND fingerprint = 'abc123'`,
      expectedIndex: 'idx_symbols_fingerprint',
    },
  ];

  const results = runExplainQueryPlan(dbPath, queries);

  // Print results
  const maxNameLen = Math.max(...results.map(r => r.name.length));
  const statusWidth = 12;

  console.log('Query Plan Results:');
  console.log('-'.repeat(maxNameLen + statusWidth + 60));

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const status = r.usesIndex ? 'INDEX' : 'SCAN';
    const icon = r.usesIndex ? '[OK]' : '[!!]';
    const name = r.name.padEnd(maxNameLen);

    console.log(`${icon} ${name}  ${status.padEnd(8)}  ${r.planDetail}`);
    if (!r.usesIndex) {
      console.log(`     Expected: ${r.expectedIndex}`);
    }

    if (r.usesIndex) passed++;
    else failed++;
  }

  console.log('-'.repeat(maxNameLen + statusWidth + 60));
  console.log(`\n=== Summary ===`);
  console.log(`Total queries: ${results.length}`);
  console.log(`Using index:   ${passed}`);
  console.log(`Full scan:     ${failed}`);

  if (failed > 0) {
    console.log(`\nWARNING: ${failed} query(s) not using indexes. Consider adding indexes for better performance.`);
  } else {
    console.log('\nAll queries are using indexes.');
  }

  // Cleanup
  await gildash.close({ cleanup: true });
  await rm(projectRoot, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
