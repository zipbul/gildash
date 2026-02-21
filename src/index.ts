// ── Public API ──
export { Codeledger } from "./codeledger";
export type { CodeledgerOptions, Logger } from "./codeledger";

// Errors
export {
  CodeledgerError,
  WatcherError,
  ParseError,
  ExtractError,
  IndexError,
  StoreError,
  SearchError,
} from "./errors";

// Search
export { symbolSearch } from "./search/symbol-search";
export type { SymbolSearchQuery, SymbolSearchResult } from "./search/symbol-search";
export { relationSearch } from "./search/relation-search";
export type { RelationSearchQuery } from "./search/relation-search";
export { DependencyGraph } from "./search/dependency-graph";