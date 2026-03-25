import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { relations as relationsTable } from '../schema';
import type { DbConnection } from '../connection';

export interface RelationRecord {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstProject: string | null;
  dstFilePath: string | null;
  dstSymbolName: string | null;
  metaJson: string | null;
  specifier: string | null;
  isExternal: number;
}

const RELATION_SELECT = {
  project: relationsTable.project,
  type: relationsTable.type,
  srcFilePath: relationsTable.srcFilePath,
  srcSymbolName: relationsTable.srcSymbolName,
  dstProject: relationsTable.dstProject,
  dstFilePath: relationsTable.dstFilePath,
  dstSymbolName: relationsTable.dstSymbolName,
  metaJson: relationsTable.metaJson,
  specifier: relationsTable.specifier,
  isExternal: relationsTable.isExternal,
} as const;

export class RelationRepository {
  constructor(private readonly db: DbConnection) {}

  replaceFileRelations(
    project: string,
    srcFilePath: string,
    rels: ReadonlyArray<Partial<RelationRecord>>,
  ): void {
    this.db.transaction((tx) => {
      tx.drizzleDb
        .delete(relationsTable)
        .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
        .run();

      if (!rels.length) return;

      for (const rel of rels) {
        tx.drizzleDb.insert(relationsTable).values({
          project,
          type: rel.type ?? 'unknown',
          srcFilePath: rel.srcFilePath ?? srcFilePath,
          srcSymbolName: rel.srcSymbolName ?? null,
          dstProject: rel.dstProject ?? (rel.dstFilePath != null ? project : null),
          dstFilePath: rel.dstFilePath ?? null,
          dstSymbolName: rel.dstSymbolName ?? null,
          metaJson: rel.metaJson ?? null,
          specifier: rel.specifier ?? null,
          isExternal: rel.isExternal ?? 0,
        }).run();
      }
    });
  }

  getOutgoing(project: string, srcFilePath: string, srcSymbolName?: string): RelationRecord[] {
    if (srcSymbolName !== undefined) {
      return this.db.drizzleDb
        .select(RELATION_SELECT)
        .from(relationsTable)
        .where(
          and(
            eq(relationsTable.project, project),
            eq(relationsTable.srcFilePath, srcFilePath),
            or(
              eq(relationsTable.srcSymbolName, srcSymbolName),
              isNull(relationsTable.srcSymbolName),
            ),
          ),
        )
        .all();
    }

    return this.db.drizzleDb
      .select(RELATION_SELECT)
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.srcFilePath, srcFilePath),
        ),
      )
      .all();
  }

  getIncoming(opts: { dstProject: string; dstFilePath: string }): RelationRecord[] {
    const { dstProject, dstFilePath } = opts;
    return this.db.drizzleDb
      .select(RELATION_SELECT)
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, dstFilePath),
        ),
      )
      .all();
  }

  getByType(project: string, type: string): RelationRecord[] {
    return this.db.drizzleDb
      .select(RELATION_SELECT)
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.type, type),
        ),
      )
      .all();
  }

  deleteFileRelations(project: string, srcFilePath: string): void {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
      .run();
  }

  deleteIncomingRelations(dstProject: string, dstFilePath: string): void {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.dstProject, dstProject), eq(relationsTable.dstFilePath, dstFilePath)))
      .run();
  }

  searchRelations(opts: {
    srcFilePath?: string;
    srcSymbolName?: string;
    dstProject?: string;
    dstFilePath?: string;
    dstSymbolName?: string;
    type?: string;
    project?: string;
    specifier?: string;
    isExternal?: boolean;
    limit?: number;
  }): RelationRecord[] {
    const builder = this.db.drizzleDb
      .select(RELATION_SELECT)
      .from(relationsTable)
      .where(
        and(
          opts.project !== undefined ? eq(relationsTable.project, opts.project) : undefined,
          opts.srcFilePath !== undefined
            ? eq(relationsTable.srcFilePath, opts.srcFilePath)
            : undefined,
          opts.srcSymbolName !== undefined
            ? eq(relationsTable.srcSymbolName, opts.srcSymbolName)
            : undefined,
          opts.dstProject !== undefined
            ? eq(relationsTable.dstProject, opts.dstProject)
            : undefined,
          opts.dstFilePath !== undefined
            ? eq(relationsTable.dstFilePath, opts.dstFilePath)
            : undefined,
          opts.dstSymbolName !== undefined
            ? eq(relationsTable.dstSymbolName, opts.dstSymbolName)
            : undefined,
          opts.type !== undefined ? eq(relationsTable.type, opts.type) : undefined,
          opts.specifier !== undefined ? eq(relationsTable.specifier, opts.specifier) : undefined,
          opts.isExternal !== undefined ? eq(relationsTable.isExternal, opts.isExternal ? 1 : 0) : undefined,
        ),
      );
    const limited = opts.limit !== undefined ? builder.limit(opts.limit) : builder;
    return limited.all();
  }

  retargetRelations(opts: {
    dstProject: string;
    oldFile: string;
    oldSymbol: string | null;
    newFile: string;
    newSymbol: string | null;
    newDstProject?: string;
  }): void {
    const { dstProject, oldFile, oldSymbol, newFile, newSymbol, newDstProject } = opts;
    const condition = oldSymbol === null
      ? and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, oldFile),
          isNull(relationsTable.dstSymbolName),
        )
      : and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, oldFile),
          eq(relationsTable.dstSymbolName, oldSymbol),
        );

    const setValues: { dstFilePath: string; dstSymbolName: string | null; dstProject?: string } = {
      dstFilePath: newFile,
      dstSymbolName: newSymbol,
    };
    if (newDstProject !== undefined) {
      setValues.dstProject = newDstProject;
    }

    this.db.drizzleDb
      .update(relationsTable)
      .set(setValues)
      .where(condition)
      .run();
  }
}
