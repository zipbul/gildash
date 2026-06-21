import type { ParsedFile } from '../parser/types';
import type { SourceSpan } from '../parser/types';
import type {
  ExtractedSymbol,
  ExpressionValue,
  ExpressionIdentifier,
  ExpressionMember,
  ExpressionCall,
  ExpressionNew,
  ExpressionFunction,
  ExpressionUnresolvable,
  ExpressionObjectProperty,
  ExpressionObjectEntry,
  KeyExpression,
  SymbolKey,
  SymbolKind,
  Modifier,
  Heritage,
  Parameter,
  Decorator as ExtractorDecorator,
} from './types';
import type {
  Span,
  Declaration,
  Class as OxcClass,
  TSInterfaceDeclaration,
  TSTypeAnnotation,
  Decorator as OxcDecorator,
  ParamPattern,
  ClassElement,
  TSSignature,
  TSEnumMember,
  TSClassImplements,
  TSInterfaceHeritage,
  TSTypeParameterDeclaration,
  PropertyKey as OxcPropertyKey,
  BindingPattern,
  Expression,
  SpreadElement,
} from 'oxc-parser';
import { buildLineOffsets, getLineColumn } from '../parser/source-position';
import { parseJsDoc } from '../parser/jsdoc-parser';
import { isErr } from '@zipbul/result';

/** Extract the name string from an oxc PropertyKey node. */
function keyName(key: OxcPropertyKey): string {
  if ('name' in key && typeof key.name === 'string') return key.name;
  if ('value' in key) {
    const v = key.value;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  }
  return 'unknown';
}

interface BindingInfo {
  name: string;
  start: number;
  end: number;
}

/** Recursively collect all binding Identifier names (with positions) from a destructuring pattern. */
function collectBindingNames(pattern: BindingPattern): BindingInfo[] {
  if (pattern.type === 'Identifier') return [{ name: pattern.name, start: pattern.start, end: pattern.end }];
  if (pattern.type === 'ObjectPattern') {
    const bindings: BindingInfo[] = [];
    for (const prop of pattern.properties) {
      if (prop.type === 'RestElement') {
        bindings.push(...collectBindingNames(prop.argument));
      } else {
        bindings.push(...collectBindingNames(prop.value));
      }
    }
    return bindings;
  }
  if (pattern.type === 'ArrayPattern') {
    const bindings: BindingInfo[] = [];
    for (const elem of pattern.elements) {
      if (!elem) continue;
      if (elem.type === 'RestElement') {
        bindings.push(...collectBindingNames(elem.argument));
      } else {
        bindings.push(...collectBindingNames(elem));
      }
    }
    return bindings;
  }
  // AssignmentPattern: const { a = 1 } = x → left is the binding
  if (pattern.type === 'AssignmentPattern') {
    return collectBindingNames(pattern.left);
  }
  return [];
}

/** Structural shape for nodes that may carry modifier flags. */
type ModifierBearing = {
  static?: boolean;
  abstract?: boolean;
  readonly?: boolean | null;
  override?: boolean;
  declare?: boolean;
  const?: boolean;
  accessibility?: string | null;
  async?: boolean;
};

interface ImportInfo {
  specifier: string;
  originalName?: string;
}

function buildStaticImportMap(parsed: ParsedFile): Map<string, ImportInfo> {
  const map = new Map<string, ImportInfo>();
  for (const imp of parsed.module.staticImports) {
    const specifier = imp.moduleRequest.value;
    for (const entry of imp.entries) {
      const localName = entry.localName.value;
      const importedName = entry.importName.kind === 'Name' ? entry.importName.name : undefined;
      const info: ImportInfo = { specifier };
      if (importedName && importedName !== localName) info.originalName = importedName;
      map.set(localName, info);
    }
  }
  return map;
}

export function extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
  const { program, sourceText, comments } = parsed;
  const lineOffsets = buildLineOffsets(sourceText);
  const importMap = buildStaticImportMap(parsed);

  // Pre-sort JSDoc block comments by `end` for binary search
  const jsDocComments = comments
    .filter((c) => c.type === 'Block' && c.value.startsWith('*'))
    .sort((a, b) => a.end - b.end);

  // Pre-sort statement starts for intervenor check
  const stmtStarts = program.body
    .map((s) => s.start)
    .sort((a, b) => a - b);

  /**
   * Convert any key node (computed expression or static literal) to a
   * `KeyExpression`.
   *
   * **Invariant**: spread (`...x`) cannot appear syntactically as a key
   * in any context (object literal property, class/interface member, enum
   * member). The runtime guarantee is upheld by oxc's grammar; we narrow
   * the return type with an `as` assertion rather than carrying a dead
   * defensive branch.
   */
  function keyExpressionFor(keyNode: OxcPropertyKey, depth: number): KeyExpression {
    return convertExpression(keyNode, depth) as KeyExpression;
  }

  /**
   * Build the structured `SymbolKey` for a class/interface member key.
   * Returns `undefined` for plain identifier keys (caller relies on the
   * symbol's `name` field).
   *
   * For static identifier object literal keys (`{ foo: 1 }`) we encode as
   * `kind: 'string'` because the runtime semantics are identical to the
   * string-literal form `{ 'foo': 1 }`. For class/interface members,
   * a plain identifier is the *default* case and the field is omitted.
   */
  function memberKey(
    key: OxcPropertyKey,
    computed: boolean,
    depth: number,
  ): SymbolKey | undefined {
    if (key.type === 'PrivateIdentifier') return { kind: 'private' };
    if (!computed && key.type === 'Identifier') return undefined;
    return keyExpressionFor(key, depth);
  }

  /**
   * The display/search name for a class/interface member.
   * - identifier `foo` → `'foo'`
   * - private `#foo` → `'#foo'` (with `#` prefix preserved)
   * - literal `'my-method'` / `42` → the literal's string form
   * - computed `[expr]` → the source text of the bracket expression
   */
  function memberDisplayName(key: OxcPropertyKey, computed: boolean): string {
    if (computed) return sourceText.slice(key.start, key.end);
    if (key.type === 'PrivateIdentifier') return `#${key.name}`;
    return keyName(key);
  }

  /**
   * Object literal property key — always a `KeyExpression` (object literals
   * cannot have private keys). For static identifier keys (`{ foo: 1 }`)
   * we encode as `{ kind: 'string', value: 'foo' }` to match the semantics
   * of `{ 'foo': 1 }`; consumers distinguishing computed vs static can
   * inspect the surrounding `shorthand` flag and the original source if
   * needed (the runtime property is identical either way).
   */
  function objectLiteralKey(
    keyNode: OxcPropertyKey,
    computed: boolean,
    depth: number,
  ): KeyExpression {
    if (!computed && keyNode.type === 'Identifier') {
      return { kind: 'string', value: keyNode.name };
    }
    return keyExpressionFor(keyNode, depth);
  }

  function span(start: number, end: number): SourceSpan {
    return {
      start: getLineColumn(lineOffsets, start),
      end: getLineColumn(lineOffsets, end),
    };
  }

  function findJsDocComment(nodeStart: number): string | undefined {
    // Binary search: find the latest JSDoc comment whose end <= nodeStart
    let lo = 0;
    let hi = jsDocComments.length - 1;
    let bestIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (jsDocComments[mid]!.end <= nodeStart) {
        bestIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (bestIdx < 0) return undefined;
    const best = jsDocComments[bestIdx]!;

    // Binary search: check if any statement starts between best.end and nodeStart
    lo = 0;
    hi = stmtStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const s = stmtStarts[mid]!;
      if (s <= best.end) {
        lo = mid + 1;
      } else if (s >= nodeStart) {
        hi = mid - 1;
      } else {
        // best.end < s < nodeStart — intervenor found
        return undefined;
      }
    }

    return `/*${best.value}*/`;
  }

  function typeText(typeAnnotation: TSTypeAnnotation | Span | null | undefined): string | undefined {
    if (!typeAnnotation) return undefined;
    const inner = ('typeAnnotation' in typeAnnotation && typeAnnotation.typeAnnotation)
      ? typeAnnotation.typeAnnotation
      : typeAnnotation;
    return sourceText.slice(inner.start, inner.end);
  }

  /**
   * Bounds the JS recursion of {@link convertExpression}. This is a stack-safety
   * guard only — oxc has already materialized the full AST in Rust; the walker
   * here just descends an existing tree. The value gives ample headroom over any
   * hand-authored config/module nesting (realistically < ~20 levels) while
   * staying far below the JS call-stack ceiling, so adversarial or machine-
   * generated input cannot overflow it. Nodes truncated by this cap are returned
   * as `unresolvable` with `reason: 'depth-cap'`, and consumers can recover the
   * original value by re-parsing the node's `sourceText`.
   */
  const MAX_EXPRESSION_DEPTH = 64;

  /**
   * Build an `unresolvable` expression value for a node we cannot structurally
   * represent. `reason` distinguishes a depth-cap truncation (recoverable) from a
   * genuinely unsupported syntactic form (left `undefined`).
   */
  function unresolvable(node: { start: number; end: number }, reason?: ExpressionUnresolvable['reason']): ExpressionUnresolvable {
    const result: ExpressionUnresolvable = { kind: 'unresolvable', sourceText: sourceText.slice(node.start, node.end) };
    if (reason) result.reason = reason;
    return result;
  }

  /** Resolve the leftmost identifier of a callee (simple or member) to its import info. */
  function resolveCalleeImport(callee: Expression): ImportInfo | undefined {
    if (callee.type === 'Identifier') return importMap.get(callee.name);
    if (callee.type === 'MemberExpression') {
      const obj = callee.object;
      if (obj.type === 'Identifier') return importMap.get(obj.name);
    }
    return undefined;
  }

  /**
   * Convert any oxc AST node we treat as an expression value into our
   * structured `ExpressionValue` model. The `node.type` discriminator of the
   * oxc `Expression` union drives all dispatch, with `SpreadElement` accepted
   * for array/argument positions and `PropertyKey` nodes for key positions.
   */
  function convertExpression(node: OxcPropertyKey | SpreadElement, depth: number = 0): ExpressionValue {
    if (depth >= MAX_EXPRESSION_DEPTH) {
      return unresolvable(node, 'depth-cap');
    }

    // Literals — oxc-parser emits ESTree "Literal" for all literal types
    if (node.type === 'Literal') {
      const value = node.value;
      if (typeof value === 'bigint') {
        // oxc preserves the numeric portion (without the trailing `n`) as a string
        const bigintText = 'bigint' in node && typeof node.bigint === 'string' ? node.bigint : value.toString();
        return { kind: 'bigint', value: bigintText };
      }
      if ('regex' in node && node.regex) {
        // Use raw source text to preserve the full /pattern/flags form
        return { kind: 'regex', value: sourceText.slice(node.start, node.end) };
      }
      if (value === null) return { kind: 'null', value: null };
      if (typeof value === 'string') return { kind: 'string', value };
      if (typeof value === 'number') return { kind: 'number', value };
      if (typeof value === 'boolean') return { kind: 'boolean', value };
      return unresolvable(node);
    }

    // Identifier — oxc-parser emits 'Identifier' for all identifier nodes
    if (node.type === 'Identifier') {
      const name = node.name;
      if (name === 'undefined') return { kind: 'undefined', value: null };
      const imp = importMap.get(name);
      const result: ExpressionIdentifier = { kind: 'identifier', name };
      if (imp) {
        result.importSource = imp.specifier;
        if (imp.originalName) result.originalName = imp.originalName;
      }
      return result;
    }

    // Member expression: a.b or a.b.c — oxc-parser emits 'MemberExpression' with computed flag
    if (node.type === 'MemberExpression') {
      if (node.computed) {
        // Allow computed access with string literal key: a['key'] → member
        const prop = node.property;
        if (prop.type === 'Literal' && typeof prop.value === 'string') {
          const obj = node.object;
          const objectText = sourceText.slice(obj.start, obj.end);
          const rootName = obj.type === 'Identifier' ? obj.name : undefined;
          const imp = rootName ? importMap.get(rootName) : undefined;
          const result: ExpressionMember = { kind: 'member', object: objectText, property: prop.value };
          if (imp) result.importSource = imp.specifier;
          return result;
        }
        return unresolvable(node);
      }
      const obj = node.object;
      const objectText = sourceText.slice(obj.start, obj.end);
      const property = node.property.name;
      // Resolve the leftmost identifier of the object chain
      const rootName = obj.type === 'Identifier' ? obj.name : undefined;
      const imp = rootName ? importMap.get(rootName) : undefined;
      const result: ExpressionMember = { kind: 'member', object: objectText, property };
      if (imp) result.importSource = imp.specifier;
      return result;
    }

    // Call expression: fn(args)
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const calleeName = sourceText.slice(callee.start, callee.end);
      const args = node.arguments.map((a) => convertExpression(a, depth + 1));
      const imp = resolveCalleeImport(callee);
      const result: ExpressionCall = { kind: 'call', callee: calleeName, arguments: args };
      if (imp) result.importSource = imp.specifier;
      return result;
    }

    // New expression: new Cls(args)
    if (node.type === 'NewExpression') {
      const callee = node.callee;
      const calleeName = sourceText.slice(callee.start, callee.end);
      const args = node.arguments.map((a) => convertExpression(a, depth + 1));
      const imp = resolveCalleeImport(callee);
      const result: ExpressionNew = { kind: 'new', callee: calleeName, arguments: args };
      if (imp) result.importSource = imp.specifier;
      return result;
    }

    // Object expression: { key: value }
    if (node.type === 'ObjectExpression') {
      const properties: ExpressionObjectEntry[] = [];
      for (const p of node.properties) {
        if (p.type === 'SpreadElement') {
          properties.push({ kind: 'spread', argument: convertExpression(p.argument, depth + 1) });
          continue;
        }
        const objKey = objectLiteralKey(p.key, p.computed, depth + 1);
        const entry: ExpressionObjectProperty = {
          kind: 'property',
          key: objKey,
          value: convertExpression(p.value, depth + 1),
        };
        if (p.shorthand) entry.shorthand = true;
        properties.push(entry);
      }
      return { kind: 'object', properties };
    }

    // Array expression: [a, b, c]
    if (node.type === 'ArrayExpression') {
      const elements = node.elements.map((e) => {
        if (!e) return { kind: 'undefined' as const, value: null };
        return convertExpression(e, depth + 1);
      });
      return { kind: 'array', elements };
    }

    // Spread element: ...x
    if (node.type === 'SpreadElement') {
      return { kind: 'spread', argument: convertExpression(node.argument, depth + 1) };
    }

    // Arrow/function expression: () => {} or function() {}
    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
      const params = node.params.map(extractParam);
      const result: ExpressionFunction = {
        kind: 'function',
        sourceText: sourceText.slice(node.start, node.end),
      };
      if (params.length > 0) result.parameters = params;
      return result;
    }

    // Template literal
    if (node.type === 'TemplateLiteral' || node.type === 'TaggedTemplateExpression') {
      return { kind: 'template', sourceText: sourceText.slice(node.start, node.end) };
    }

    // Unary expression: !x, -1, typeof x, void 0
    if (node.type === 'UnaryExpression') {
      const argument = node.argument;
      // Handle negative numbers: -1, -3.14
      if (node.operator === '-' && argument.type === 'Literal' && typeof argument.value === 'number') {
        return { kind: 'number', value: -argument.value };
      }
      // void 0 → undefined
      if (node.operator === 'void') {
        return { kind: 'undefined', value: null };
      }
      return unresolvable(node);
    }

    // Transparent wrappers — unwrap to inner expression
    if (
      node.type === 'TSAsExpression' ||
      node.type === 'TSSatisfiesExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'TSTypeAssertion' ||
      node.type === 'TSInstantiationExpression' ||
      node.type === 'ParenthesizedExpression'
    ) {
      return convertExpression(node.expression, depth);
    }
    if (node.type === 'ChainExpression') {
      return convertExpression(node.expression, depth);
    }

    // Fallback: anything we can't structurally represent
    return unresolvable(node);
  }

  function extractDecorators(decorators: readonly OxcDecorator[]): ExtractorDecorator[] {
    if (!decorators || decorators.length === 0) return [];
    return decorators.map((d) => {
      const expr = d.expression;
      if (expr.type === 'CallExpression') {
        const callee = expr.callee;
        const calleeName =
          ('name' in callee && typeof callee.name === 'string')
            ? callee.name
            : ('property' in callee && 'name' in callee.property && typeof callee.property.name === 'string')
              ? callee.property.name
              : 'unknown';
        const args = expr.arguments.map((a) => convertExpression(a));
        return { name: calleeName, arguments: args.length > 0 ? args : undefined };
      }
      if (expr.type === 'Identifier') return { name: expr.name ?? 'unknown' };
      return { name: sourceText.slice(expr.start, expr.end) };
    });
  }

  function extractParam(p: ParamPattern): Parameter {
    if (p.type === 'TSParameterProperty') {
      return extractParamFromBinding(p.parameter, p.decorators);
    }
    if (p.type === 'RestElement') {
      const rest = p;
      const arg = rest.argument;
      const argName: string = ('name' in arg && typeof arg.name === 'string') ? arg.name : 'unknown';
      const name = `...${argName}`;
      const typeAnn = rest.typeAnnotation;
      const type = typeAnn ? typeText(typeAnn) : undefined;
      const param: Parameter = { name, isOptional: false };
      if (type) param.type = type;
      return param;
    }
    // FormalParameter = { decorators?: Array<Decorator> } & BindingPattern
    return extractParamFromBinding(p, p.decorators);
  }

  /** Extract the root type name from a type annotation for import resolution. */
  function resolveTypeImportSource(typeAnn: TSTypeAnnotation | null | undefined): string | undefined {
    if (!typeAnn) return undefined;
    const inner = typeAnn.typeAnnotation;
    // Only a bare `TSTypeReference` (e.g. `Foo`, `Foo.Bar`) carries an import-resolvable name.
    if (inner.type !== 'TSTypeReference') return undefined;
    const typeName = inner.typeName;
    const rootName = typeName.type === 'Identifier' ? typeName.name : undefined;
    if (!rootName) return undefined;
    return importMap.get(rootName)?.specifier;
  }

  function extractParamFromBinding(
    inner: BindingPattern,
    decorators?: readonly OxcDecorator[],
  ): Parameter {
    if (inner.type === 'AssignmentPattern') {
      const left = inner.left;
      const right = inner.right;
      const name: string = ('name' in left && typeof left.name === 'string') ? left.name : 'unknown';
      // @oxc-project/types declares `BindingIdentifier.typeAnnotation?: null` and
      // `decorators?: []`, but oxc emits a real `TSTypeAnnotation`/decorators here at
      // runtime (verified: `function f(a: string = 1)` → `left.typeAnnotation` is a
      // TSTypeAnnotation). These casts bridge that upstream type inaccuracy — they are
      // NOT a workaround for our own modelling, and removing them loses the annotation.
      const typeAnn = ('typeAnnotation' in left) ? left.typeAnnotation as TSTypeAnnotation | null : null;
      const type = typeAnn ? typeText(typeAnn) : undefined;
      const typeImportSource = resolveTypeImportSource(typeAnn);
      const defaultValue: string = sourceText.slice(right.start, right.end);
      const leftDecos = ('decorators' in left && Array.isArray(left.decorators)) ? left.decorators as OxcDecorator[] : [];
      const decos = extractDecorators(leftDecos);
      const param: Parameter = { name, isOptional: true, defaultValue };
      if (type) param.type = type;
      if (typeImportSource) param.typeImportSource = typeImportSource;
      if (decos.length > 0) param.decorators = decos;
      return param;
    }

    // BindingIdentifier | ObjectPattern | ArrayPattern
    const name: string = ('name' in inner && typeof inner.name === 'string')
      ? inner.name
      : ('pattern' in inner && inner.pattern && typeof (inner.pattern as { name?: string }).name === 'string')
        ? (inner.pattern as { name: string }).name
        : 'unknown';
    const optional: boolean = !!('optional' in inner && inner.optional);
    const typeAnn = ('typeAnnotation' in inner) ? inner.typeAnnotation as TSTypeAnnotation | null : null;
    const type = typeAnn ? typeText(typeAnn) : undefined;
    const typeImportSource = resolveTypeImportSource(typeAnn);
    const decos = extractDecorators(decorators ?? []);
    const param: Parameter = { name, isOptional: optional };
    if (type) param.type = type;
    if (typeImportSource) param.typeImportSource = typeImportSource;
    if (decos.length > 0) param.decorators = decos;
    return param;
  }

  function extractModifiers(node: ModifierBearing, fn?: ModifierBearing): Modifier[] {
    const mods: Modifier[] = [];
    if (fn?.async) mods.push('async');
    if (node.static) mods.push('static');
    if (node.abstract) mods.push('abstract');
    if (node.readonly) mods.push('readonly');
    if (node.override) mods.push('override');
    if (node.declare) mods.push('declare');
    if (node.const) mods.push('const');
    const acc = node.accessibility;
    if (acc === 'private') mods.push('private');
    else if (acc === 'protected') mods.push('protected');
    else if (acc === 'public') mods.push('public');
    return mods;
  }

  function extractTypeParams(tp: TSTypeParameterDeclaration | null | undefined): string[] | undefined {
    if (!tp) return undefined;
    const names = tp.params.flatMap((p) => {
      const n = p.name.name;
      return n ? [n] : [];
    });
    return names.length > 0 ? names : undefined;
  }

  function classHeritage(node: OxcClass): Heritage[] {
    const heritage: Heritage[] = [];
    if (node.superClass) {
      const name = sourceText.slice(node.superClass.start, node.superClass.end);
      heritage.push({ kind: 'extends', name });
    }
    const impls: readonly TSClassImplements[] = node.implements ?? [];
    for (const impl of impls) {
      const expr = impl.expression;
      const name = sourceText.slice(expr.start, expr.end);
      heritage.push({ kind: 'implements', name });
    }
    return heritage;
  }

  function interfaceHeritage(node: TSInterfaceDeclaration): Heritage[] {
    const heritage: Heritage[] = [];
    const exts: readonly TSInterfaceHeritage[] = node.extends;
    for (const ext of exts) {
      const expr = ext.expression;
      const name = sourceText.slice(expr.start, expr.end);
      heritage.push({ kind: 'extends', name });
    }
    return heritage;
  }

  function extractClassMembers(bodyNodes: readonly ClassElement[]): ExtractedSymbol[] {
    const members: ExtractedSymbol[] = [];
    for (const m of bodyNodes) {
      if (m.type === 'MethodDefinition' || m.type === 'TSAbstractMethodDefinition') {
        const md = m;
        const name: string = memberDisplayName(md.key, md.computed);
        const key = memberKey(md.key, md.computed, 0);
        const fnValue = md.value;
        const rawKind: string = md.kind;
        const methodKind =
          rawKind === 'constructor'
            ? 'constructor'
            : rawKind === 'get'
              ? 'getter'
              : rawKind === 'set'
                ? 'setter'
                : 'method';
        const mods = extractModifiers(md, fnValue);
        if (m.type === 'TSAbstractMethodDefinition' && !mods.includes('abstract')) {
          mods.push('abstract');
        }
        const params = fnValue.params.map(extractParam);
        const returnType = typeText(fnValue.returnType);
        const decos = extractDecorators(md.decorators ?? []);
        const s: ExtractedSymbol = {
          kind: 'method',
          name,
          span: span(m.start, m.end),
          isExported: false,
          methodKind,
          modifiers: mods,
          parameters: params.length > 0 ? params : undefined,
          returnType,
        };
        if (key) s.key = key;
        if (decos.length > 0) s.decorators = decos;
        members.push(s);
      } else if (
        m.type === 'PropertyDefinition' ||
        m.type === 'TSAbstractPropertyDefinition' ||
        m.type === 'AccessorProperty' ||
        m.type === 'TSAbstractAccessorProperty'
      ) {
        const pd = m;
        const name: string = memberDisplayName(pd.key, pd.computed);
        const key = memberKey(pd.key, pd.computed, 0);
        const mods = extractModifiers(pd);
        if (m.type === 'TSAbstractPropertyDefinition' || m.type === 'TSAbstractAccessorProperty') {
          if (!mods.includes('abstract')) mods.push('abstract');
        }
        if (m.type === 'AccessorProperty' || m.type === 'TSAbstractAccessorProperty') {
          mods.push('accessor');
        }
        const returnType = typeText(pd.typeAnnotation);
        const initNode = pd.value;
        const initializer = initNode
          ? convertExpression(initNode)
          : undefined;
        const decos = extractDecorators(pd.decorators);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: mods,
          returnType,
          initializer,
        };
        if (key) s.key = key;
        if (decos.length > 0) s.decorators = decos;
        members.push(s);
      }
    }
    return members;
  }

  function extractInterfaceMembers(bodyNodes: readonly TSSignature[]): ExtractedSymbol[] {
    const members: ExtractedSymbol[] = [];
    for (const m of bodyNodes) {
      if (m.type === 'TSMethodSignature') {
        const ms = m;
        const name: string = memberDisplayName(ms.key, ms.computed);
        const key = memberKey(ms.key, ms.computed, 0);
        const params = ms.params.map(extractParam);
        const returnType = typeText(ms.returnType);
        const s: ExtractedSymbol = {
          kind: 'method',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: [],
          methodKind: 'method',
          parameters: params.length > 0 ? params : undefined,
          returnType,
        };
        if (key) s.key = key;
        members.push(s);
      } else if (m.type === 'TSPropertySignature') {
        const ps = m;
        const name: string = memberDisplayName(ps.key, ps.computed);
        const key = memberKey(ps.key, ps.computed, 0);
        const typeAnn = typeText(ps.typeAnnotation);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: ps.readonly ? ['readonly'] : [],
          returnType: typeAnn,
        };
        if (key) s.key = key;
        members.push(s);
      }
    }
    return members;
  }

  function buildSymbol(node: Declaration | Expression, isExported: boolean): ExtractedSymbol | ExtractedSymbol[] | null {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'TSDeclareFunction' || node.type === 'TSEmptyBodyFunctionExpression') {
      const fn = node;
      const name: string = fn.id?.name ?? 'default';
      const params = fn.params.map(extractParam);
      const returnType = typeText(fn.returnType);
      const mods = extractModifiers(fn, fn);
      // Function decorators are a stage 3 proposal; @oxc-project/types doesn't declare them,
      // but the parser may emit them at runtime. Access via cast for forward-compatibility.
      const decos = extractDecorators((fn as unknown as { decorators?: OxcDecorator[] }).decorators ?? []);
      const typeParameters = extractTypeParams(fn.typeParameters);
      const sym: ExtractedSymbol = {
        kind: 'function',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        parameters: params.length > 0 ? params : undefined,
        returnType,
        decorators: decos.length > 0 ? decos : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const cls = node;
      const name: string = cls.id?.name ?? 'default';
      const heritage = classHeritage(cls);
      const members = extractClassMembers(cls.body.body);
      const decos = extractDecorators(cls.decorators);
      const mods = extractModifiers(cls);
      const typeParameters = extractTypeParams(cls.typeParameters);
      const sym: ExtractedSymbol = {
        kind: 'class',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        heritage: heritage.length > 0 ? heritage : undefined,
        members: members.length > 0 ? members : undefined,
        decorators: decos.length > 0 ? decos : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (node.type === 'VariableDeclaration') {
      const varDecl = node;
      const symbols: ExtractedSymbol[] = [];
      for (const decl of varDecl.declarations) {
        const id = decl.id;
        const init = decl.init;

        if (id.type === 'ObjectPattern' || id.type === 'ArrayPattern') {
          const bindings = collectBindingNames(id);
          for (const binding of bindings) {
            symbols.push({
              kind: 'variable',
              name: binding.name,
              span: span(binding.start, binding.end),
              isExported,
              modifiers: [],
            });
          }
          continue;
        }

        const name: string = ('name' in id && typeof id.name === 'string') ? id.name : 'unknown';
        let kind: SymbolKind = 'variable';
        let params: Parameter[] | undefined;
        let returnType: string | undefined;

        let initializer: ExpressionValue | undefined;
        if (init) {
          if (
            init.type === 'FunctionExpression' ||
            init.type === 'ArrowFunctionExpression'
          ) {
            kind = 'function';
            const fnInit = init;
            const rawParams = fnInit.params;
            params = rawParams.map(extractParam);
            returnType = typeText(fnInit.returnType);
          } else {
            initializer = convertExpression(init);
          }
        }
        const mods: Modifier[] = [];
        const sym: ExtractedSymbol = {
          kind,
          name,
          span: span(decl.start, decl.end),
          isExported,
          modifiers: mods,
          parameters: params,
          returnType,
        };
        if (initializer) sym.initializer = initializer;
        symbols.push(sym);
      }
      if (symbols.length === 0) return null;
      if (symbols.length === 1) return symbols[0]!;
      return symbols;
    }

    if (node.type === 'TSTypeAliasDeclaration') {
      const ta = node;
      const name: string = ta.id.name;
      return {
        kind: 'type',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: [],
      };
    }

    if (node.type === 'TSInterfaceDeclaration') {
      const iface = node;
      const name: string = iface.id.name;
      const heritage = interfaceHeritage(iface);
      const members = extractInterfaceMembers(iface.body.body);
      const typeParameters = extractTypeParams(iface.typeParameters);
      const sym: ExtractedSymbol = {
        kind: 'interface',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: [],
        heritage: heritage.length > 0 ? heritage : undefined,
        members: members.length > 0 ? members : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (node.type === 'TSEnumDeclaration') {
      const enumDecl = node;
      const name: string = enumDecl.id.name;
      const mods = extractModifiers(enumDecl);
      const rawMembers: readonly TSEnumMember[] = enumDecl.body.members;
      const members: ExtractedSymbol[] = rawMembers.map((m) => {
        const memberId = m.id;
        const isLiteral = memberId.type !== 'Identifier';
        const memberName: string = ('name' in memberId && typeof memberId.name === 'string')
          ? memberId.name
          : ('value' in memberId && typeof memberId.value === 'string')
            ? memberId.value
            : 'unknown';
        const initializer = m.initializer ? convertExpression(m.initializer) : undefined;
        const sym: ExtractedSymbol = {
          kind: 'property',
          name: memberName,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: [],
        };
        if (isLiteral) {
          // Enum members can have string-literal IDs (e.g. `enum E { 'foo' = 1 }`).
          // Preserve via the same `key` model used elsewhere.
          sym.key = keyExpressionFor(memberId, 0);
        }
        if (initializer) sym.initializer = initializer;
        return sym;
      });
      return {
        kind: 'enum',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        members: members.length > 0 ? members : undefined,
      };
    }

    if (node.type === 'TSModuleDeclaration') {
      const name: string = 'name' in node.id
        ? node.id.name
        : 'value' in node.id ? node.id.value : 'unknown';
      const mods = extractModifiers(node);

      // Extract exported members from the namespace body (TSModuleBlock)
      const members: ExtractedSymbol[] = [];
      if (node.body?.type === 'TSModuleBlock') {
        for (const stmt of node.body.body) {
          if (stmt.type !== 'ExportNamedDeclaration') continue;
          const decl = stmt.declaration;
          if (!decl) continue;
          const memberSym = buildSymbol(decl, false);
          if (memberSym) {
            if (Array.isArray(memberSym)) members.push(...memberSym);
            else members.push(memberSym);
          }
        }
      }

      return {
        kind: 'namespace',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        members: members.length > 0 ? members : undefined,
      };
    }

    return null;
  }

  const result: ExtractedSymbol[] = [];
  const deferredExportNames = new Set<string>();

  for (const node of program.body) {
    let sym: ExtractedSymbol | ExtractedSymbol[] | null = null;
    const stmtNode = node;

    if (stmtNode.type === 'ExportNamedDeclaration') {
      const n = stmtNode;
      if (n.declaration) {
        sym = buildSymbol(n.declaration, true);
        if (sym && !Array.isArray(sym)) {
          sym.span = span(n.start, n.end);
        }
      } else if (!n.source && n.specifiers) {
        for (const spec of n.specifiers) {
          const local = spec.local;
          const localName = 'name' in local ? local.name : local.value;
          if (localName) deferredExportNames.add(localName);
        }
      }
    } else if (stmtNode.type === 'ExportDefaultDeclaration') {
      const n = stmtNode;
      const decl = n.declaration;
      if (decl) {
        sym = buildSymbol(decl, true);
        if (sym && !Array.isArray(sym)) {
          sym.name = 'id' in decl && decl.id && typeof decl.id.name === 'string'
            ? decl.id.name
            : 'default';
          sym.isExported = true;
          sym.span = span(n.start, n.end);
        } else if (!sym && decl.type === 'Identifier') {
          // export default <identifier> — mark the referenced variable as exported
          const identName = decl.name;
          if (identName) deferredExportNames.add(identName);
        }
      }
    } else {
      // Only attempt to build symbols from Declaration nodes
      const declType = stmtNode.type;
      if (
        declType === 'FunctionDeclaration' ||
        declType === 'TSDeclareFunction' ||
        declType === 'ClassDeclaration' ||
        declType === 'VariableDeclaration' ||
        declType === 'TSTypeAliasDeclaration' ||
        declType === 'TSInterfaceDeclaration' ||
        declType === 'TSEnumDeclaration' ||
        declType === 'TSModuleDeclaration'
      ) {
        sym = buildSymbol(stmtNode, false);
      }
    }

    const syms: ExtractedSymbol[] = Array.isArray(sym) ? sym : sym ? [sym] : [];
    for (const s of syms) {
      const nodeStart = node.start;
      const jsdocText = findJsDocComment(nodeStart);
      if (jsdocText) {
        const jsDocResult = parseJsDoc(jsdocText);
        if (!isErr(jsDocResult)) s.jsDoc = jsDocResult;
      }
      result.push(s);
    }
  }

  if (deferredExportNames.size > 0) {
    for (const s of result) {
      if (!s.isExported && deferredExportNames.has(s.name)) {
        s.isExported = true;
      }
    }
  }

  return result;
}
