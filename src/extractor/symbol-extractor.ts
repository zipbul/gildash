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
  SymbolKind,
  Modifier,
  Heritage,
  Parameter,
  Decorator as ExtractorDecorator,
} from './types';
import type {
  Span,
  Statement,
  Directive,
  Declaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  Function as OxcFunction,
  Class as OxcClass,
  VariableDeclaration,
  TSTypeAliasDeclaration,
  TSInterfaceDeclaration,
  TSEnumDeclaration,
  TSTypeAnnotation,
  Decorator as OxcDecorator,
  ParamPattern,
  TSParameterProperty,
  FormalParameterRest,
  ClassElement,
  MethodDefinition,
  PropertyDefinition,
  TSSignature,
  TSMethodSignature,
  TSPropertySignature,
  TSEnumMember,
  TSClassImplements,
  TSInterfaceHeritage,
  TSTypeParameterDeclaration,
  PropertyKey as OxcPropertyKey,
  BindingPattern,
  BindingProperty,
  ArrowFunctionExpression,
  CallExpression as OxcCallExpression,
  IdentifierReference,
  Argument,
} from 'oxc-parser';
import { buildLineOffsets, getLineColumn } from '../parser/source-position';
import { parseJsDoc } from '../parser/jsdoc-parser';
import { isErr } from '@zipbul/result';

/** Extract the name string from an oxc PropertyKey node. */
function keyName(key: OxcPropertyKey): string {
  if ('name' in key && typeof key.name === 'string') return key.name;
  if ('value' in key && typeof key.value === 'string') return key.value;
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
        bindings.push(...collectBindingNames(prop.argument as BindingPattern));
      } else {
        bindings.push(...collectBindingNames((prop as BindingProperty).value));
      }
    }
    return bindings;
  }
  if (pattern.type === 'ArrayPattern') {
    const bindings: BindingInfo[] = [];
    for (const elem of pattern.elements) {
      if (!elem) continue;
      if (elem.type === 'RestElement') {
        bindings.push(...collectBindingNames(elem.argument as BindingPattern));
      } else {
        bindings.push(...collectBindingNames(elem as BindingPattern));
      }
    }
    return bindings;
  }
  // AssignmentPattern: const { a = 1 } = x → left is the binding
  if (pattern.type === 'AssignmentPattern') {
    return collectBindingNames(pattern.left as BindingPattern);
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
      ? typeAnnotation.typeAnnotation as Span
      : typeAnnotation;
    return sourceText.slice(inner.start, inner.end);
  }

  const MAX_EXPRESSION_DEPTH = 8;

  /** Resolve the leftmost identifier of a callee (simple or member) to its import info. */
  function resolveCalleeImport(callee: Record<string, unknown>): ImportInfo | undefined {
    if (callee.type === 'Identifier') return importMap.get(callee.name as string);
    if (callee.type === 'MemberExpression') {
      const obj = callee.object as Record<string, unknown>;
      if (obj.type === 'Identifier') return importMap.get(obj.name as string);
    }
    return undefined;
  }

  function convertExpression(node: Record<string, unknown>, depth: number = 0): ExpressionValue {
    if (depth >= MAX_EXPRESSION_DEPTH) {
      return { kind: 'unresolvable', sourceText: sourceText.slice(node.start as number, node.end as number) };
    }

    const type = node.type as string;

    // Literals — oxc-parser emits ESTree "Literal" for all literal types
    if (type === 'Literal') {
      const value = node.value;
      if (value === null) return { kind: 'null', value: null };
      if (typeof value === 'string') return { kind: 'string', value };
      if (typeof value === 'number') return { kind: 'number', value };
      if (typeof value === 'boolean') return { kind: 'boolean', value };
      // BigInt, RegExp, etc. → unresolvable
      return { kind: 'unresolvable', sourceText: sourceText.slice(node.start as number, node.end as number) };
    }

    // Identifier — oxc-parser emits 'Identifier' for all identifier nodes
    if (type === 'Identifier') {
      const name = node.name as string;
      if (name === 'undefined') return { kind: 'undefined', value: null };
      const imp = importMap.get(name);
      const result: ExpressionValue = { kind: 'identifier', name };
      if (imp) {
        (result as ExpressionIdentifier).importSource = imp.specifier;
        if (imp.originalName) (result as ExpressionIdentifier).originalName = imp.originalName;
      }
      return result;
    }

    // Member expression: a.b or a.b.c — oxc-parser emits 'MemberExpression' with computed flag
    if (type === 'MemberExpression') {
      if (node.computed) {
        // Allow computed access with string literal key: a['key'] → member
        const prop = node.property as Record<string, unknown>;
        if (prop.type === 'Literal' && typeof prop.value === 'string') {
          const obj = node.object as Record<string, unknown>;
          const objectText = sourceText.slice(obj.start as number, obj.end as number);
          const rootName = obj.type === 'Identifier' ? obj.name as string : undefined;
          const imp = rootName ? importMap.get(rootName) : undefined;
          const result: ExpressionValue = { kind: 'member', object: objectText, property: prop.value };
          if (imp) (result as ExpressionMember).importSource = imp.specifier;
          return result;
        }
        return { kind: 'unresolvable', sourceText: sourceText.slice(node.start as number, node.end as number) };
      }
      const obj = node.object as Record<string, unknown>;
      const objectText = sourceText.slice(obj.start as number, obj.end as number);
      const property = (node.property as Record<string, unknown>).name as string
        ?? sourceText.slice(
          (node.property as Record<string, unknown>).start as number,
          (node.property as Record<string, unknown>).end as number,
        );
      // Resolve the leftmost identifier of the object chain
      const rootName = obj.type === 'Identifier' ? obj.name as string : undefined;
      const imp = rootName ? importMap.get(rootName) : undefined;
      const result: ExpressionValue = { kind: 'member', object: objectText, property };
      if (imp) (result as ExpressionMember).importSource = imp.specifier;
      return result;
    }

    // Call expression: fn(args)
    if (type === 'CallExpression') {
      const callee = node.callee as Record<string, unknown>;
      const calleeName = sourceText.slice(callee.start as number, callee.end as number);
      const rawArgs = (node.arguments as Array<Record<string, unknown>>) ?? [];
      const args = rawArgs.map((a) => convertExpression(a, depth + 1));
      const imp = resolveCalleeImport(callee);
      const result: ExpressionValue = { kind: 'call', callee: calleeName, arguments: args };
      if (imp) (result as ExpressionCall).importSource = imp.specifier;
      return result;
    }

    // New expression: new Cls(args)
    if (type === 'NewExpression') {
      const callee = node.callee as Record<string, unknown>;
      const calleeName = sourceText.slice(callee.start as number, callee.end as number);
      const rawArgs = (node.arguments as Array<Record<string, unknown>>) ?? [];
      const args = rawArgs.map((a) => convertExpression(a, depth + 1));
      const imp = resolveCalleeImport(callee);
      const result: ExpressionValue = { kind: 'new', callee: calleeName, arguments: args };
      if (imp) (result as ExpressionNew).importSource = imp.specifier;
      return result;
    }

    // Object expression: { key: value }
    if (type === 'ObjectExpression') {
      const rawProps = (node.properties as Array<Record<string, unknown>>) ?? [];
      const properties = rawProps.map((p) => {
        if ((p.type as string) === 'SpreadElement') {
          const arg = p.argument as Record<string, unknown>;
          return {
            key: '...',
            value: { kind: 'spread' as const, argument: convertExpression(arg, depth + 1) },
          };
        }
        const key = p.key as Record<string, unknown>;
        const rawKeyName = key.name ?? key.value;
        const keyName = rawKeyName != null ? String(rawKeyName) : sourceText.slice(key.start as number, key.end as number);
        const value = p.value as Record<string, unknown>;
        const computed = (p.computed as boolean) || undefined;
        const shorthand = (p.shorthand as boolean) || undefined;
        return { key: keyName, value: convertExpression(value, depth + 1), computed, shorthand };
      });
      return { kind: 'object', properties };
    }

    // Array expression: [a, b, c]
    if (type === 'ArrayExpression') {
      const rawElements = (node.elements as Array<Record<string, unknown> | null>) ?? [];
      const elements = rawElements.map((e) => {
        if (!e) return { kind: 'undefined' as const, value: null };
        return convertExpression(e, depth + 1);
      });
      return { kind: 'array', elements };
    }

    // Spread element: ...x
    if (type === 'SpreadElement') {
      const arg = node.argument as Record<string, unknown>;
      return { kind: 'spread', argument: convertExpression(arg, depth + 1) };
    }

    // Arrow/function expression: () => {} or function() {}
    if (type === 'ArrowFunctionExpression' || type === 'FunctionExpression') {
      const fnNode = node as unknown as OxcFunction | ArrowFunctionExpression;
      const params = fnNode.params.map(extractParam);
      const result: ExpressionFunction = {
        kind: 'function',
        sourceText: sourceText.slice(node.start as number, node.end as number),
      };
      if (params.length > 0) result.parameters = params;
      return result;
    }

    // Template literal
    if (type === 'TemplateLiteral' || type === 'TaggedTemplateExpression') {
      return { kind: 'template', sourceText: sourceText.slice(node.start as number, node.end as number) };
    }

    // Unary expression: !x, -1, typeof x, void 0
    if (type === 'UnaryExpression') {
      const operator = node.operator as string;
      const argument = node.argument as Record<string, unknown>;
      // Handle negative numbers: -1, -3.14
      if (operator === '-' && argument.type === 'Literal' && typeof argument.value === 'number') {
        return { kind: 'number', value: -(argument.value as number) };
      }
      // void 0 → undefined
      if (operator === 'void') {
        return { kind: 'undefined', value: null };
      }
      return { kind: 'unresolvable', sourceText: sourceText.slice(node.start as number, node.end as number) };
    }

    // Transparent wrappers — unwrap to inner expression
    if (
      type === 'TSAsExpression' ||
      type === 'TSSatisfiesExpression' ||
      type === 'TSNonNullExpression' ||
      type === 'TSTypeAssertion' ||
      type === 'TSInstantiationExpression' ||
      type === 'ParenthesizedExpression' ||
      type === 'ChainExpression'
    ) {
      const inner = node.expression as Record<string, unknown>;
      if (inner) return convertExpression(inner, depth);
    }

    // Fallback: anything we can't structurally represent
    return { kind: 'unresolvable', sourceText: sourceText.slice(node.start as number, node.end as number) };
  }

  function extractDecorators(decorators: readonly OxcDecorator[]): ExtractorDecorator[] {
    if (!decorators || decorators.length === 0) return [];
    return decorators.map((d) => {
      const expr = d.expression;
      if (expr.type === 'CallExpression') {
        const callExpr = expr as OxcCallExpression;
        const callee = callExpr.callee;
        const calleeName =
          ('name' in callee && typeof callee.name === 'string')
            ? callee.name
            : ('property' in callee && callee.property && typeof (callee.property as { name?: string }).name === 'string')
              ? (callee.property as { name: string }).name
              : 'unknown';
        const args = callExpr.arguments.map((a: Argument) =>
          convertExpression(a as unknown as Record<string, unknown>),
        );
        return { name: calleeName, arguments: args.length > 0 ? args : undefined };
      }
      if (expr.type === 'Identifier') return { name: (expr as IdentifierReference).name ?? 'unknown' };
      return { name: sourceText.slice(expr.start, expr.end) };
    });
  }

  function extractParam(p: ParamPattern): Parameter {
    if (p.type === 'TSParameterProperty') {
      const tsp = p as TSParameterProperty;
      return extractParamFromBinding(tsp.parameter, tsp.decorators);
    }
    if (p.type === 'RestElement') {
      const rest = p as FormalParameterRest;
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
    const fp = p as BindingPattern & { decorators?: OxcDecorator[] };
    return extractParamFromBinding(fp, fp.decorators);
  }

  /** Extract the root type name from a type annotation for import resolution. */
  function resolveTypeImportSource(typeAnn: TSTypeAnnotation | null | undefined): string | undefined {
    if (!typeAnn) return undefined;
    const inner = ('typeAnnotation' in typeAnn && typeAnn.typeAnnotation)
      ? typeAnn.typeAnnotation as unknown as Record<string, unknown>
      : null;
    if (!inner) return undefined;
    // TSTypeReference → typeName is an Identifier
    const typeName = inner.typeName as Record<string, unknown> | undefined;
    const rootName = typeName?.name as string | undefined;
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
        const md = m as MethodDefinition;
        const name: string = keyName(md.key);
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
        if (decos.length > 0) s.decorators = decos;
        members.push(s);
      } else if (m.type === 'PropertyDefinition' || m.type === 'TSAbstractPropertyDefinition') {
        const pd = m as PropertyDefinition;
        const name: string = keyName(pd.key);
        const mods = extractModifiers(pd);
        if (m.type === 'TSAbstractPropertyDefinition' && !mods.includes('abstract')) {
          mods.push('abstract');
        }
        const returnType = typeText(pd.typeAnnotation);
        const initNode = pd.value;
        const initializer = initNode
          ? convertExpression(initNode as unknown as Record<string, unknown>)
          : undefined;
        const decos = extractDecorators(pd.decorators ?? []);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: mods,
          returnType,
          initializer,
        };
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
        const ms = m as TSMethodSignature;
        const name: string = keyName(ms.key);
        const params = ms.params.map(extractParam);
        const returnType = typeText(ms.returnType);
        members.push({
          kind: 'method',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: [],
          methodKind: 'method',
          parameters: params.length > 0 ? params : undefined,
          returnType,
        });
      } else if (m.type === 'TSPropertySignature') {
        const ps = m as TSPropertySignature;
        const name: string = keyName(ps.key);
        const typeAnn = typeText(ps.typeAnnotation);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: ps.readonly ? ['readonly'] : [],
          returnType: typeAnn,
        };
        members.push(s);
      }
    }
    return members;
  }

  function buildSymbol(node: Declaration, isExported: boolean): ExtractedSymbol | ExtractedSymbol[] | null {
    const type: string = node.type;

    if (type === 'FunctionDeclaration' || type === 'FunctionExpression' || type === 'TSDeclareFunction' || type === 'TSEmptyBodyFunctionExpression') {
      const fn = node as OxcFunction;
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

    if (type === 'ClassDeclaration' || type === 'ClassExpression') {
      const cls = node as OxcClass;
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

    if (type === 'VariableDeclaration') {
      const varDecl = node as VariableDeclaration;
      const symbols: ExtractedSymbol[] = [];
      for (const decl of varDecl.declarations) {
        const id = decl.id;
        const init = decl.init;

        if (id.type === 'ObjectPattern' || id.type === 'ArrayPattern') {
          const bindings = collectBindingNames(id);
          for (const binding of bindings) {
            symbols.push({
              kind: 'variable' as SymbolKind,
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
            const fnInit = init as OxcFunction | ArrowFunctionExpression;
            const rawParams = fnInit.params;
            params = rawParams.map(extractParam);
            returnType = typeText(fnInit.returnType);
          } else {
            initializer = convertExpression(init as unknown as Record<string, unknown>);
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

    if (type === 'TSTypeAliasDeclaration') {
      const ta = node as TSTypeAliasDeclaration;
      const name: string = ta.id.name;
      return {
        kind: 'type',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: [],
      };
    }

    if (type === 'TSInterfaceDeclaration') {
      const iface = node as TSInterfaceDeclaration;
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

    if (type === 'TSEnumDeclaration') {
      const enumDecl = node as TSEnumDeclaration;
      const name: string = enumDecl.id.name;
      const mods = extractModifiers(enumDecl);
      const rawMembers: readonly TSEnumMember[] = enumDecl.body.members;
      const members: ExtractedSymbol[] = rawMembers.map((m) => {
        const memberId = m.id;
        const memberName: string = ('name' in memberId && typeof memberId.name === 'string')
          ? memberId.name
          : ('value' in memberId && typeof memberId.value === 'string')
            ? memberId.value
            : 'unknown';
        const initNode = m.initializer;
        const initializer = initNode
          ? convertExpression(initNode as unknown as Record<string, unknown>)
          : undefined;
        const sym: ExtractedSymbol = {
          kind: 'property' as SymbolKind,
          name: memberName,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: [],
        };
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

    if (type === 'TSModuleDeclaration') {
      const mod = node as { id: { name?: string; value?: string }; body?: { type?: string; body?: Array<Record<string, unknown>> }; declare?: boolean; start: number; end: number };
      const name: string = mod.id.name ?? mod.id.value ?? 'unknown';
      const mods = extractModifiers(mod);

      // Extract exported members from the namespace body (TSModuleBlock)
      const members: ExtractedSymbol[] = [];
      if (mod.body?.type === 'TSModuleBlock') {
        for (const stmt of mod.body.body ?? []) {
          if (stmt.type !== 'ExportNamedDeclaration') continue;
          const decl = stmt.declaration as Record<string, unknown> | undefined;
          if (!decl) continue;
          const memberSym = buildSymbol(decl as unknown as Declaration, false);
          if (memberSym) {
            if (Array.isArray(memberSym)) members.push(...memberSym);
            else members.push(memberSym);
          }
        }
      }

      return {
        kind: 'namespace' as SymbolKind,
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
    const stmtNode = node as Statement | Directive;

    if (stmtNode.type === 'ExportNamedDeclaration') {
      const n = stmtNode as ExportNamedDeclaration;
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
      const n = stmtNode as ExportDefaultDeclaration;
      const decl = n.declaration;
      if (decl) {
        sym = buildSymbol(decl as Declaration, true);
        if (sym && !Array.isArray(sym)) {
          sym.name = ('id' in decl && decl.id && typeof (decl.id as { name?: string }).name === 'string')
            ? (decl.id as { name: string }).name
            : 'default';
          sym.isExported = true;
          sym.span = span(n.start, n.end);
        } else if (!sym && 'type' in decl && (decl as { type: string }).type === 'Identifier') {
          // export default <identifier> — mark the referenced variable as exported
          const identName = (decl as IdentifierReference).name;
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
        sym = buildSymbol(stmtNode as Declaration, false);
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
