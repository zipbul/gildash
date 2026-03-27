export { Gildash } from "./gildash";
export type { GildashOptions, Logger, SymbolDiff, ModuleInterface, HeritageNode, FullSymbol, FileStats, FanMetrics, ResolvedSymbol, BatchParseResult } from "./gildash";

export { GildashError } from "./errors";
export type { GildashErrorType } from "./errors";

export { symbolSearch } from "./search/symbol-search";
export type { SymbolSearchQuery, SymbolSearchResult, SymbolDetail } from "./search/symbol-search";
export { relationSearch } from "./search/relation-search";
export type { RelationSearchQuery, StoredCodeRelation } from "./search/relation-search";
export { DependencyGraph } from "./search/dependency-graph";
export { patternSearch } from "./search/pattern-search";
export type { PatternMatch } from "./search/pattern-search";

export type { IndexResult } from "./indexer/index-coordinator";
export type { ProjectBoundary } from "./common/project-discovery";
export type { CodeRelation, ExtractedSymbol, SymbolKind, Decorator, Parameter, Heritage, Modifier, JsDocBlock, JsDocTag } from "./extractor/types";
export type { SymbolStats } from "./store/repositories/symbol.repository";
export type { WatcherRole, FileChangeEvent } from "./watcher/types";
export type { ParsedFile } from "./parser/types";
export type { FileRecord } from "./store/repositories/file.repository";

export type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface, SemanticDiagnostic, GetDiagnosticsOptions } from "./semantic/types";
export type { SymbolNode } from "./semantic/symbol-graph";

export type { AnnotationSource, ExtractedAnnotation } from "./extractor/types";
export type { AnnotationSearchQuery, AnnotationSearchResult } from "./search/annotation-search";
export type { SymbolChange, SymbolChangeType, SymbolChangeQueryOptions } from "./gildash/types";

// Path utilities for consumers
export { normalizePath } from './common/path-utils';

// Internal parser utilities for consumers
export { buildLineOffsets, getLineColumn } from './parser/source-position';
export type { SourcePosition, SourceSpan } from './parser/types';

// oxc AST types for consumers
export type { Program, Node } from 'oxc-parser';
export { Visitor, visitorKeys } from 'oxc-parser';
export type { VisitorObject } from 'oxc-parser';
