import type { SourcePosition, SourceSpan } from '../parser/types';

/**
 * A structured representation of a JavaScript/TypeScript expression.
 *
 * Used for decorator arguments, variable initializers, enum member values,
 * and property initializers — anywhere an expression's structure matters
 * beyond its raw source text.
 *
 * The extractor does **not** resolve imports; use relation queries for that.
 */
export type ExpressionValue =
  | ExpressionLiteral
  | ExpressionIdentifier
  | ExpressionMember
  | ExpressionCall
  | ExpressionNew
  | ExpressionObject
  | ExpressionArray
  | ExpressionSpread
  | ExpressionFunction
  | ExpressionTemplate
  | ExpressionUnresolvable;

export interface ExpressionLiteral {
  kind: 'string' | 'number' | 'boolean' | 'null' | 'undefined';
  value: string | number | boolean | null;
}

export interface ExpressionIdentifier {
  kind: 'identifier';
  name: string;
  /** Import specifier if this identifier is imported (e.g. `'./my.service'`, `'@zipbul/http-adapter'`). */
  importSource?: string;
  /** Original exported name when imported under an alias (e.g. `import { Foo as Bar }` → `'Foo'`). */
  originalName?: string;
}

export interface ExpressionMember {
  kind: 'member';
  /** Full dot-separated expression text, e.g. `'HttpMethod.Get'`. */
  object: string;
  property: string;
  /** Import specifier of the object identifier. */
  importSource?: string;
}

export interface ExpressionCall {
  kind: 'call';
  callee: string;
  /** Import specifier of the callee (simple identifier or leftmost member object). */
  importSource?: string;
  arguments: ExpressionValue[];
}

export interface ExpressionNew {
  kind: 'new';
  callee: string;
  /** Import specifier of the callee (simple identifier or leftmost member object). */
  importSource?: string;
  arguments: ExpressionValue[];
}

export interface ExpressionObject {
  kind: 'object';
  properties: ExpressionObjectProperty[];
}

export interface ExpressionObjectProperty {
  key: string;
  value: ExpressionValue;
  computed?: boolean;
  shorthand?: boolean;
}

export interface ExpressionArray {
  kind: 'array';
  elements: ExpressionValue[];
}

export interface ExpressionSpread {
  kind: 'spread';
  argument: ExpressionValue;
}

export interface ExpressionFunction {
  kind: 'function';
  sourceText: string;
  /** Parameters of the function expression (name, type, importSource). */
  parameters?: Parameter[];
}

export interface ExpressionTemplate {
  kind: 'template';
  sourceText: string;
}

export interface ExpressionUnresolvable {
  kind: 'unresolvable';
  sourceText: string;
}

/**
 * The kind of a symbol extracted from TypeScript source.
 *
 * - `'function'` — standalone function declarations and expressions
 * - `'method'` — class methods, getters, setters, and constructors
 * - `'class'` — class declarations
 * - `'variable'` — `const`, `let`, `var` declarations
 * - `'type'` — type alias declarations
 * - `'interface'` — interface declarations
 * - `'enum'` — enum declarations
 * - `'namespace'` — `namespace`, `declare namespace`, and `declare module` declarations
 * - `'property'` — class properties and interface/type members
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'property';

/**
 * TypeScript declaration modifiers attached to a symbol.
 */
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

/**
 * A function/method parameter.
 */
export interface Parameter {
  /** Parameter name. */
  name: string;
  /** Type annotation as raw source text, e.g. `"string"`, `"number[]"`. */
  type?: string;
  /** Import specifier of the type annotation identifier (e.g. `'./my.service'`). */
  typeImportSource?: string;
  /** Whether the parameter is optional (has `?` or a default value). */
  isOptional: boolean;
  /** Default value expression as source text. */
  defaultValue?: string;
  /** Decorators applied to this parameter (e.g. `@Inject`, `@Body`). */
  decorators?: Decorator[];
}

/**
 * A class/interface heritage clause (`extends` or `implements`).
 */
export interface Heritage {
  /** Whether this is an `extends` or `implements` clause. */
  kind: 'extends' | 'implements';
  /** Name of the base class or implemented interface. */
  name: string;
  /** Generic type arguments, e.g. `['T', 'U']`. */
  typeArguments?: string[];
}

/**
 * A decorator applied to a class, method, property, or parameter.
 */
export interface Decorator {
  /** Decorator name without `@`. */
  name: string;
  /** Structured decorator call arguments. */
  arguments?: ExpressionValue[];
}

/**
 * A single JSDoc tag parsed from a documentation comment.
 *
 * @example
 * For `@param name - The user's name`:
 * ```ts
 * { tag: 'param', name: 'name', type: '', description: "The user's name", optional: false }
 * ```
 */
export interface JsDocTag {
  /** Tag name without `@` (e.g. `'param'`, `'returns'`, `'deprecated'`). */
  tag: string;
  /** First word after the tag, typically a parameter name for `@param`. */
  name: string;
  /** Type in curly braces (e.g. `'{string}'` → `'string'`). Empty if absent. */
  type: string;
  /** Description text following the name. */
  description: string;
  /** `true` if the name is wrapped in `[brackets]` (optional parameter). */
  optional: boolean;
  /** Default value if `[name=default]` syntax is used. */
  default?: string;
}

/**
 * A parsed JSDoc documentation comment block.
 */
export interface JsDocBlock {
  /** Full description text before any tags. */
  description: string;
  /** Parsed `@tag` entries. */
  tags: JsDocTag[];
}

/**
 * A symbol extracted from a TypeScript source file.
 *
 * Represents a single named declaration (function, class, variable, type, etc.)
 * with its location, metadata, and optional nested members.
 */
export interface ExtractedSymbol {
  /** What kind of symbol this is. */
  kind: SymbolKind;
  /** Symbol name (e.g. `'MyClass'`, `'handleClick'`). */
  name: string;
  /** Source location (start/end line and column). */
  span: SourceSpan;
  /** Whether this symbol is exported from its module. */
  isExported: boolean;
  /** For methods: distinguishes `'method'`, `'getter'`, `'setter'`, or `'constructor'`. */
  methodKind?: 'method' | 'getter' | 'setter' | 'constructor';

  /** Function/method parameters. Present for functions, methods, and constructors. */
  parameters?: Parameter[];
  /** Return type annotation as source text. */
  returnType?: string;
  /** Generic type parameter names (e.g. `['T', 'U extends Foo']`). */
  typeParameters?: string[];
  /** Declaration modifiers (e.g. `async`, `static`, `readonly`). */
  modifiers: Modifier[];
  /** Heritage clauses (`extends` / `implements`). Present for classes and interfaces. */
  heritage?: Heritage[];
  /** Decorators applied to this symbol. */
  decorators?: Decorator[];
  /** Initializer expression (enum member values, property defaults, variable initializers). */
  initializer?: ExpressionValue;
  /** Nested members (class fields, methods, interface properties, enum members). */
  members?: ExtractedSymbol[];
  /** Parsed JSDoc comment associated with this symbol. */
  jsDoc?: JsDocBlock;
}

/**
 * A dot-separated qualified name (e.g. `a.b.c`).
 */
export interface QualifiedName {
  /** Leftmost identifier (e.g. `'a'` in `'a.b.c'`). */
  root: string;
  /** Subsequent parts (e.g. `['b', 'c']`). */
  parts: string[];
  /** Full joined string (e.g. `'a.b.c'`). */
  full: string;
}

/**
 * An import reference resolved from an import statement.
 */
export interface ImportReference {
  /** Resolved absolute path of the imported module. */
  path: string;
  /** The imported name: `'default'` for default imports, `'*'` for namespace, or the named identifier. */
  importedName: string;
}

/**
 * A relationship between two symbols/files extracted from source code.
 *
 * - `'imports'` — file A imports from file B
 * - `'type-references'` — file A type-only imports from file B (`import type`)
 * - `'re-exports'` — file A re-exports from file B (`export { ... } from`)
 * - `'calls'` — symbol in file A calls a symbol in file B
 * - `'extends'` — class/interface in file A extends one in file B
 * - `'implements'` — class in file A implements an interface in file B
 */
export interface CodeRelation {
  /** The kind of relationship. */
  type: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  /** File path where the relationship originates. */
  srcFilePath: string;
  /** Source symbol name, or `null` for module-level relationships. */
  srcSymbolName: string | null;
  /** File path of the target. `null` for external/unresolved imports. */
  dstFilePath: string | null;
  /** Target symbol name, or `null` for module-level imports. */
  dstSymbolName: string | null;
  /** Optional JSON-encoded metadata about the relation. */
  metaJson?: string;
  /** Parsed metadata object derived from `metaJson`. */
  meta?: Record<string, unknown>;
  /** Raw import specifier (e.g. `'lodash'`, `'./missing'`). Present for unresolved/external imports. */
  specifier?: string;
}

export type AnnotationSource = 'jsdoc' | 'line' | 'block';

export interface ExtractedAnnotation {
  tag: string;
  value: string;
  source: AnnotationSource;
  span: SourceSpan;
  symbolName: string | null;
}

export type { SourcePosition, SourceSpan };
