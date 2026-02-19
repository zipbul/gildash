import type { SourcePosition, SourceSpan } from '../parser/types';

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'property';

export type Modifier =
  | 'async'
  | 'static'
  | 'abstract'
  | 'readonly'
  | 'private'
  | 'protected'
  | 'public'
  | 'override'
  | 'declare'
  | 'const';

export interface Parameter {
  name: string;
  /** Type annotation as source text. */
  type?: string;
  isOptional: boolean;
  defaultValue?: string;
  /** Parameter-level decorators (e.g., @Inject, @Body). */
  decorators?: Decorator[];
}

export interface Heritage {
  kind: 'extends' | 'implements';
  name: string;
  typeArguments?: string[];
}

export interface Decorator {
  name: string;
  arguments?: string[];
}

export interface JsDocTag {
  /** Tag name without '@'. e.g., 'param', 'see', 'deprecated'. */
  tag: string;
  /** First word after tag. e.g., parameter name for @param. */
  name: string;
  /** Type in curly braces. e.g., '{string}' → 'string'. */
  type: string;
  /** Remaining text after name. */
  description: string;
  /** True if name is wrapped in [brackets]. */
  optional: boolean;
  /** Default value if [name=default] syntax. */
  default?: string;
}

export interface JsDocBlock {
  /** Full description text before any tags. */
  description: string;
  /** Parsed @tag entries. */
  tags: JsDocTag[];
}

export interface ExtractedSymbol {
  kind: SymbolKind;
  name: string;
  span: SourceSpan;
  isExported: boolean;
  methodKind?: 'method' | 'getter' | 'setter' | 'constructor';

  // Rich metadata — populated when applicable, undefined otherwise.
  parameters?: Parameter[];
  returnType?: string;
  typeParameters?: string[];
  modifiers: Modifier[];
  heritage?: Heritage[];
  decorators?: Decorator[];
  /** Recursive: class/interface/enum members. */
  members?: ExtractedSymbol[];
  /** Parsed JSDoc comment associated with this symbol. */
  jsDoc?: JsDocBlock;
}

export interface QualifiedName {
  /** Leftmost identifier (e.g., 'a' in 'a.b.c'). */
  root: string;
  /** Subsequent parts (['b', 'c']). */
  parts: string[];
  /** Joined ('a.b.c'). */
  full: string;
}

export interface ImportReference {
  /** Resolved absolute path of imported module. */
  path: string;
  /** 'default', '*', or named identifier. */
  importedName: string;
}

export interface CodeRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  /** null = module-level. */
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
}

export type { SourcePosition, SourceSpan };
