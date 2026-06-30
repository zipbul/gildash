/**
 * project-router — route SemanticLayer calls to the program that governs each
 * file in a multi-tsconfig monorepo.
 *
 * Owns one lazily-created {@link SemanticLayer} per tsconfig and dispatches each
 * call to the layer of the file's nearest-up config ({@link SemanticProjectResolver}).
 * A config whose layer fails to build is isolated: its files degrade (empty /
 * `null` results, `isFileInSemanticProgram === false`) instead of throwing, and
 * other projects keep working. This is structurally a `SemanticLayerLike`, so it
 * is a drop-in for `ctx.semanticLayer`.
 *
 * Routing is by file path; two-file operations are answered only when both files
 * share one program (cross-project comparison is not meaningful across separate
 * TypeCheckers and returns `null`).
 */

import type { SemanticLayer } from './index';
import type { SemanticProjectResolver } from './project-resolver';
import type {
  ResolvedType,
  ByteSpan,
  SemanticReference,
  EnrichedReference,
  FileBinding,
  Implementation,
  SemanticModuleInterface,
  SemanticDiagnostic,
  GetDiagnosticsOptions,
} from './types';
import type { SymbolNode } from './symbol-graph';

/** Builds (or throws for) the semantic layer of a given tsconfig. */
export type SemanticLayerFactory = (configPath: string) => SemanticLayer;

export class SemanticProjectRouter {
  readonly #resolver: SemanticProjectResolver;
  readonly #createLayer: SemanticLayerFactory;
  readonly #layers = new Map<string, SemanticLayer>();
  readonly #failed = new Set<string>();
  #disposed = false;

  constructor(resolver: SemanticProjectResolver, createLayer: SemanticLayerFactory) {
    this.#resolver = resolver;
    this.#createLayer = createLayer;
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  /** Lazily get the layer for a config path, caching build failures (no retry). */
  #layerForConfig(configPath: string | null): SemanticLayer | null {
    if (this.#disposed || configPath === null || this.#failed.has(configPath)) return null;
    const existing = this.#layers.get(configPath);
    if (existing) return existing;
    let layer: SemanticLayer;
    try {
      layer = this.#createLayer(configPath);
    } catch {
      this.#failed.add(configPath);
      return null;
    }
    this.#layers.set(configPath, layer);
    return layer;
  }

  /** The governing layer for a file, or `null` if unowned / failed. */
  #layerForFile(filePath: string): SemanticLayer | null {
    return this.#layerForConfig(this.#resolver.resolve(filePath));
  }

  /** Whether `filePath` is actually present in its governing healthy program. */
  isFileInSemanticProgram(filePath: string): boolean {
    // Delegate to the layer: a built config layer does not imply the file is in
    // its program (it may be excluded/never-fed), so check actual membership.
    return this.#layerForFile(filePath)?.isFileInSemanticProgram(filePath) ?? false;
  }

  // ── Types ────────────────────────────────────────────────────────────────

  collectTypeAt(filePath: string, position: number): ResolvedType | null {
    return this.#layerForFile(filePath)?.collectTypeAt(filePath, position) ?? null;
  }

  collectFileTypes(filePath: string): Map<number, ResolvedType> {
    return this.#layerForFile(filePath)?.collectFileTypes(filePath) ?? new Map();
  }

  collectTypesAtPositions(filePath: string, positions: number[]): Map<number, ResolvedType> {
    return this.#layerForFile(filePath)?.collectTypesAtPositions(filePath, positions) ?? new Map();
  }

  collectAtSpan(filePath: string, span: ByteSpan): ResolvedType | null {
    return this.#layerForFile(filePath)?.collectAtSpan(filePath, span) ?? null;
  }

  isThenableAtSpan(filePath: string, span: ByteSpan, options?: { anyConstituent?: boolean }): boolean | null {
    return this.#layerForFile(filePath)?.isThenableAtSpan(filePath, span, options) ?? null;
  }

  contextualCallReturnsAtSpan(filePath: string, span: ByteSpan): ResolvedType[] | null {
    return this.#layerForFile(filePath)?.contextualCallReturnsAtSpan(filePath, span) ?? null;
  }

  isTypeAssignableToTypeAtSpan(
    filePath: string,
    span: ByteSpan,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    return this.#layerForFile(filePath)?.isTypeAssignableToTypeAtSpan(filePath, span, targetTypeExpression, options) ?? null;
  }

  isTypeAssignableToType(
    filePath: string,
    position: number,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    return this.#layerForFile(filePath)?.isTypeAssignableToType(filePath, position, targetTypeExpression, options) ?? null;
  }

  isTypeAssignableToTypeAtPositions(
    filePath: string,
    positions: number[],
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): Map<number, boolean> {
    return this.#layerForFile(filePath)?.isTypeAssignableToTypeAtPositions(filePath, positions, targetTypeExpression, options) ?? new Map();
  }

  /** Two-file: only meaningful when both files share one program. */
  isTypeAssignableTo(
    sourceFilePath: string,
    sourcePosition: number,
    targetFilePath: string,
    targetPosition: number,
  ): boolean | null {
    const srcConfig = this.#resolver.resolve(sourceFilePath);
    const tgtConfig = this.#resolver.resolve(targetFilePath);
    if (srcConfig === null || srcConfig !== tgtConfig) return null;
    return this.#layerForConfig(srcConfig)?.isTypeAssignableTo(sourceFilePath, sourcePosition, targetFilePath, targetPosition) ?? null;
  }

  // ── References / implementations (intra-project; cross-project omitted) ────

  findReferences(filePath: string, position: number): SemanticReference[] {
    return this.#layerForFile(filePath)?.findReferences(filePath, position) ?? [];
  }

  findEnrichedReferences(filePath: string, position: number): EnrichedReference[] {
    return this.#layerForFile(filePath)?.findEnrichedReferences(filePath, position) ?? [];
  }

  findImplementations(filePath: string, position: number): Implementation[] {
    return this.#layerForFile(filePath)?.findImplementations(filePath, position) ?? [];
  }

  // ── Bindings ───────────────────────────────────────────────────────────

  getFileBindings(filePath: string): FileBinding[] {
    return this.#layerForFile(filePath)?.getFileBindings(filePath) ?? [];
  }

  getStandaloneFileBindings(filePath: string, content: string): FileBinding[] {
    // Program-independent: route to the owning layer for its compiler-options
    // template, falling back to the root config so files governed by no config
    // still resolve their local bindings.
    const layer = this.#layerForFile(filePath) ?? this.#layerForConfig(this.#resolver.rootConfig());
    return layer?.getStandaloneFileBindings(filePath, content) ?? [];
  }

  getFileBindingsBatch(files: ReadonlyArray<{ filePath: string; content: string }>): Map<string, FileBinding[]> {
    // Group by governing config so each program's batch rebuild is amortized once.
    const byConfig = new Map<string | null, Array<{ filePath: string; content: string }>>();
    for (const f of files) {
      const config = this.#resolver.resolve(f.filePath);
      const group = byConfig.get(config);
      if (group) group.push(f);
      else byConfig.set(config, [f]);
    }
    const out = new Map<string, FileBinding[]>();
    for (const [config, group] of byConfig) {
      const layer = this.#layerForConfig(config);
      const result = layer?.getFileBindingsBatch(group);
      for (const f of group) out.set(f.filePath, result?.get(f.filePath) ?? []);
    }
    return out;
  }

  // ── Symbol graph / module interface ──────────────────────────────────────

  getSymbolNode(filePath: string, position: number): SymbolNode | null {
    return this.#layerForFile(filePath)?.getSymbolNode(filePath, position) ?? null;
  }

  getBaseTypes(filePath: string, position: number): ResolvedType[] | null {
    return this.#layerForFile(filePath)?.getBaseTypes(filePath, position) ?? null;
  }

  getModuleInterface(filePath: string): SemanticModuleInterface {
    return this.#layerForFile(filePath)?.getModuleInterface(filePath) ?? { filePath, exports: [] };
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────

  getDiagnostics(filePath: string, options?: GetDiagnosticsOptions): SemanticDiagnostic[] {
    return this.#layerForFile(filePath)?.getDiagnostics(filePath, options) ?? [];
  }

  // ── Position helpers ─────────────────────────────────────────────────────

  lineColumnToPosition(filePath: string, line: number, column: number): number | null {
    return this.#layerForFile(filePath)?.lineColumnToPosition(filePath, line, column) ?? null;
  }

  findNamePosition(filePath: string, declarationPos: number, name: string): number | null {
    return this.#layerForFile(filePath)?.findNamePosition(filePath, declarationPos, name) ?? null;
  }

  // ── Mutation / lifecycle ─────────────────────────────────────────────────

  notifyFileChanged(filePath: string, content: string): void {
    this.#layerForFile(filePath)?.notifyFileChanged(filePath, content);
  }

  notifyFileDeleted(filePath: string): void {
    this.#layerForFile(filePath)?.notifyFileDeleted(filePath);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const layer of this.#layers.values()) layer.dispose();
    this.#layers.clear();
  }
}
