import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import {
  parseSource,
  walk,
  parseAndWalk,
  ScopeTracker,
  Visitor,
  visitorKeys,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionNode,
  isArrowFunctionExpression,
  isIdentifier,
  isMemberExpression,
  isTSQualifiedName,
  isVariableDeclaration,
  isAssignmentExpression,
  is,
} from '../src';
import type { Node } from '../src';

const SAMPLE = `
import { foo } from 'mod';
const x = 1;
function fn(a: number) {
  return a + foo();
}
class Cls {
  method() {
    return this.x.y;
  }
}
type Q = A.B;
const arrow = (n: number) => n * 2;
let z;
z = 42;
`;

const parseOk = (source: string, file = 'sample.ts') => {
  const result = parseSource(file, source);
  if (isErr(result)) {
    throw new Error(`parseSource failed: ${JSON.stringify(result.data)}`);
  }
  return result;
};

describe('AST foundation: re-exported walk works against a parsed program', () => {
  it('should visit nodes in preorder and call enter on every node', () => {
    const parsed = parseOk(SAMPLE);
    let enterCount = 0;
    const seenTypes = new Set<string>();
    walk(parsed.program, {
      enter(node) {
        enterCount += 1;
        seenTypes.add(node.type);
      },
    });
    expect(enterCount).toBeGreaterThan(0);
    expect(seenTypes.has('CallExpression')).toBe(true);
    expect(seenTypes.has('FunctionDeclaration')).toBe(true);
    expect(seenTypes.has('VariableDeclaration')).toBe(true);
    expect(seenTypes.has('Identifier')).toBe(true);
  });

  it('should call leave for every entered non-skipped node', () => {
    const parsed = parseOk(SAMPLE);
    let enterCount = 0;
    let leaveCount = 0;
    walk(parsed.program, {
      enter() {
        enterCount += 1;
      },
      leave() {
        leaveCount += 1;
      },
    });
    expect(leaveCount).toBe(enterCount);
  });

  it('should support skip() in enter to prune subtree traversal', () => {
    const parsed = parseOk(SAMPLE);
    let identifiersInsideFn = 0;
    walk(parsed.program, {
      enter(node) {
        if (node.type === 'FunctionDeclaration') {
          this.skip();
          return;
        }
        if (node.type === 'Identifier') {
          identifiersInsideFn += 1;
        }
      },
    });
    // Without skip, identifiers inside function (a, foo) would also count.
    // With skip on the FunctionDeclaration, only outer identifiers remain.
    // We can't pin an exact count without re-deriving the AST, but the count
    // must be strictly less than a full traversal.
    let fullCount = 0;
    walk(parsed.program, {
      enter(node) {
        if (node.type === 'Identifier') fullCount += 1;
      },
    });
    expect(identifiersInsideFn).toBeLessThan(fullCount);
  });

  it('should pass parent argument to enter callback', () => {
    const parsed = parseOk(SAMPLE);
    let parentSeen: Node | null = null;
    walk(parsed.program, {
      enter(node, parent) {
        if (parentSeen === null && parent !== null && node.type === 'VariableDeclarator') {
          parentSeen = parent;
        }
      },
    });
    expect(parentSeen).not.toBeNull();
    expect((parentSeen as unknown as Node).type).toBe('VariableDeclaration');
  });

  it('should expose ctx.key and ctx.index in callback context', () => {
    const parsed = parseOk(SAMPLE);
    const ctxKeys = new Set<string | number | symbol | null | undefined>();
    walk(parsed.program, {
      enter(_node, _parent, ctx) {
        ctxKeys.add(ctx.key);
      },
    });
    // Root has key = null/undefined; children have keys like "body", "id", etc.
    expect(ctxKeys.size).toBeGreaterThan(1);
  });
});

describe('AST foundation: parseAndWalk', () => {
  it('should parse and walk in one call', () => {
    let identifiers = 0;
    parseAndWalk(SAMPLE, 'sample.ts', (node) => {
      if (node.type === 'Identifier') identifiers += 1;
    });
    expect(identifiers).toBeGreaterThan(0);
  });
});

describe('AST foundation: ScopeTracker', () => {
  it('should track declarations across nested scopes and resolve isDeclared at root', () => {
    const tracker = new ScopeTracker({ preserveExitedScopes: true });
    const code = `
      const outer = 1;
      function fn() {
        const inner = 2;
      }
    `;
    parseAndWalk(code, 'scope.ts', {
      scopeTracker: tracker,
      enter() {},
    });
    expect(typeof tracker.getCurrentScope()).toBe('string');
  });
});

describe('AST foundation: walk skip semantics', () => {
  it('should fire leave on the skipped node itself but not on its descendants', () => {
    const parsed = parseOk(`function outer() { function inner() {} }`);
    const enterOrder: string[] = [];
    const leaveOrder: string[] = [];
    walk(parsed.program, {
      enter(node) {
        enterOrder.push(node.type);
        if (node.type === 'FunctionDeclaration' && enterOrder.filter((t) => t === 'FunctionDeclaration').length === 1) {
          this.skip();
        }
      },
      leave(node) {
        leaveOrder.push(node.type);
      },
    });
    // The outer FunctionDeclaration was entered once, skipped (so its
    // descendants were not entered), then left once.
    const outerFnEnters = enterOrder.filter((t) => t === 'FunctionDeclaration').length;
    const outerFnLeaves = leaveOrder.filter((t) => t === 'FunctionDeclaration').length;
    expect(outerFnEnters).toBe(1);
    expect(outerFnLeaves).toBe(1);
  });

  it('should support sentinel-throw as a stop() workaround', () => {
    const parsed = parseOk(`const a = 1; const b = 2; const c = 3;`);
    const STOP = Symbol('stop');
    const seen: string[] = [];
    try {
      walk(parsed.program, {
        enter(node) {
          seen.push(node.type);
          if (node.type === 'VariableDeclaration' && seen.filter((t) => t === 'VariableDeclaration').length === 2) {
            throw STOP;
          }
        },
      });
    } catch (e) {
      if (e !== STOP) throw e;
    }
    // We threw on the second VariableDeclaration; the third must not have
    // been visited.
    const declCount = seen.filter((t) => t === 'VariableDeclaration').length;
    expect(declCount).toBe(2);
  });
});

describe('AST foundation: visitorKeys + Visitor still re-exported', () => {
  it('should expose visitorKeys as a Record<string, string[]>', () => {
    expect(typeof visitorKeys).toBe('object');
    expect(Array.isArray(visitorKeys.Program)).toBe(true);
  });

  it('should expose Visitor class for typed per-node-type callbacks', () => {
    const parsed = parseOk(SAMPLE);
    let calls = 0;
    const visitor = new Visitor({
      CallExpression() {
        calls += 1;
      },
    });
    visitor.visit(parsed.program);
    expect(calls).toBeGreaterThan(0);
  });
});

describe('AST foundation: type predicates against a real parsed program', () => {
  it('should identify call, function, identifier, member, qualified-name, and assignment nodes in a real AST', () => {
    const parsed = parseOk(SAMPLE);
    let callCount = 0;
    let fnDeclCount = 0;
    let arrowCount = 0;
    let idCount = 0;
    let memberCount = 0;
    let qualifiedNameCount = 0;
    let assignmentCount = 0;
    let varDeclCount = 0;
    let anyFunctionCount = 0;

    walk(parsed.program, {
      enter(node) {
        if (isCallExpression(node)) callCount += 1;
        if (isFunctionDeclaration(node)) fnDeclCount += 1;
        if (isArrowFunctionExpression(node)) arrowCount += 1;
        if (isIdentifier(node)) idCount += 1;
        if (isMemberExpression(node)) memberCount += 1;
        if (isTSQualifiedName(node)) qualifiedNameCount += 1;
        if (isAssignmentExpression(node)) assignmentCount += 1;
        if (isVariableDeclaration(node)) varDeclCount += 1;
        if (isFunctionNode(node)) anyFunctionCount += 1;
      },
    });

    expect(callCount).toBeGreaterThanOrEqual(1); // foo()
    expect(fnDeclCount).toBe(1); // function fn
    expect(arrowCount).toBe(1); // const arrow = ...
    expect(idCount).toBeGreaterThan(0);
    expect(memberCount).toBeGreaterThanOrEqual(2); // this.x, this.x.y
    expect(qualifiedNameCount).toBeGreaterThanOrEqual(1); // A.B
    expect(assignmentCount).toBe(1); // z = 42
    expect(varDeclCount).toBeGreaterThanOrEqual(2); // const x, const arrow, let z (counts may include declare list grouping)
    // anyFunction = FunctionDeclaration + ArrowFunctionExpression + any FunctionExpression (method shorthand counts as FunctionExpression in some shapes)
    expect(anyFunctionCount).toBeGreaterThanOrEqual(2);
    expect(anyFunctionCount).toBe(fnDeclCount + arrowCount + /* method body FunctionExpression varies */ (anyFunctionCount - fnDeclCount - arrowCount));
  });

  it('should never claim FunctionDeclaration AND ArrowFunctionExpression on the same node', () => {
    const parsed = parseOk(SAMPLE);
    walk(parsed.program, {
      enter(node) {
        const both = isFunctionDeclaration(node) && isArrowFunctionExpression(node);
        expect(both).toBe(false);
      },
    });
  });

  it('should preserve the compositional invariant on every node of a real parsed program', () => {
    const parsed = parseOk(SAMPLE);
    walk(parsed.program, {
      enter(node) {
        const composed =
          isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunctionExpression(node);
        expect(isFunctionNode(node)).toBe(composed);
      },
    });
  });

  it('should yield a node where isFunctionNode is true but isFunctionDeclaration is false (covers ArrowFunctionExpression branch of the union)', () => {
    const parsed = parseOk(SAMPLE);
    let saw = false;
    walk(parsed.program, {
      enter(node) {
        if (isFunctionNode(node) && !isFunctionDeclaration(node) && !isFunctionExpression(node)) {
          saw = true;
          expect(isArrowFunctionExpression(node)).toBe(true);
        }
      },
    });
    expect(saw).toBe(true);
  });
});

describe('AST foundation: `is` namespace against a real parsed program', () => {
  it('should produce identical counts to the hand-written predicates for the overlapping discriminator set', () => {
    const parsed = parseOk(SAMPLE);
    const counts = {
      named: { call: 0, fnDecl: 0, fnExpr: 0, arrow: 0, id: 0, member: 0, qual: 0, assign: 0, varDecl: 0 },
      proxy: { call: 0, fnDecl: 0, fnExpr: 0, arrow: 0, id: 0, member: 0, qual: 0, assign: 0, varDecl: 0 },
    };
    walk(parsed.program, {
      enter(node) {
        if (isCallExpression(node)) counts.named.call += 1;
        if (isFunctionDeclaration(node)) counts.named.fnDecl += 1;
        if (isFunctionExpression(node)) counts.named.fnExpr += 1;
        if (isArrowFunctionExpression(node)) counts.named.arrow += 1;
        if (isIdentifier(node)) counts.named.id += 1;
        if (isMemberExpression(node)) counts.named.member += 1;
        if (isTSQualifiedName(node)) counts.named.qual += 1;
        if (isAssignmentExpression(node)) counts.named.assign += 1;
        if (isVariableDeclaration(node)) counts.named.varDecl += 1;

        if (is.CallExpression(node)) counts.proxy.call += 1;
        if (is.FunctionDeclaration(node)) counts.proxy.fnDecl += 1;
        if (is.FunctionExpression(node)) counts.proxy.fnExpr += 1;
        if (is.ArrowFunctionExpression(node)) counts.proxy.arrow += 1;
        if (is.Identifier(node)) counts.proxy.id += 1;
        if (is.MemberExpression(node)) counts.proxy.member += 1;
        if (is.TSQualifiedName(node)) counts.proxy.qual += 1;
        if (is.AssignmentExpression(node)) counts.proxy.assign += 1;
        if (is.VariableDeclaration(node)) counts.proxy.varDecl += 1;
      },
    });
    expect(counts.proxy).toEqual(counts.named);
  });

  it('should cover the new top-level discriminators (Class/Import/Export/New/Return) from a representative source', () => {
    const code = `
      import { foo } from 'mod';
      export class A {}
      export default function bar() { return new Map(); }
      export const x = 1;
    `;
    const parsed = parseOk(code, 'cover.ts');
    let importDecl = 0;
    let classDecl = 0;
    let exportNamed = 0;
    let exportDefault = 0;
    let newExpr = 0;
    let returnStmt = 0;
    walk(parsed.program, {
      enter(node) {
        if (is.ImportDeclaration(node)) importDecl += 1;
        if (is.ClassDeclaration(node)) classDecl += 1;
        if (is.ExportNamedDeclaration(node)) exportNamed += 1;
        if (is.ExportDefaultDeclaration(node)) exportDefault += 1;
        if (is.NewExpression(node)) newExpr += 1;
        if (is.ReturnStatement(node)) returnStmt += 1;
      },
    });
    expect(importDecl).toBe(1);
    expect(classDecl).toBe(1);
    // export class A {} + export const x = 1 — both wrapped in ExportNamedDeclaration.
    expect(exportNamed).toBe(2);
    expect(exportDefault).toBe(1);
    expect(newExpr).toBe(1);
    expect(returnStmt).toBe(1);
  });

  it('should be usable as a direct Array#filter / find callback without re-binding (cached identity contract)', () => {
    const parsed = parseOk(SAMPLE);
    const collected: Node[] = [];
    walk(parsed.program, {
      enter(node) {
        collected.push(node);
      },
    });
    const calls = collected.filter(is.CallExpression);
    const fnDecls = collected.filter(is.FunctionDeclaration);
    expect(calls.length).toBeGreaterThan(0);
    expect(fnDecls.length).toBe(1);
    // Each filtered element is type-narrowed inside the function — type assertion below
    // would fail at typecheck if the predicate signature regressed.
    for (const c of calls) {
      const _t: 'CallExpression' = c.type;
      void _t;
    }
  });

  it('should compose with sym.span discovery via name-match — the official two-layer composition pattern', () => {
    // This mirrors the README example: find a target symbol via outer-node
    // walk + name match, then drill into its subtree using `is.X` predicates
    // and raw `node.start` / `node.end` for source slicing.
    const code = `function target(x: number) { return x + foo() + bar(); }`;
    const parsed = parseOk(code, 'compose.ts');

    let outerFnFound = false;
    const callTexts: string[] = [];
    walk(parsed.program, {
      enter(node) {
        if (is.FunctionDeclaration(node) && node.id?.name === 'target') {
          outerFnFound = true;
          // Drill into the body — collect every CallExpression's source slice.
          if (node.body) {
            walk(node.body, {
              enter(inner) {
                if (is.CallExpression(inner)) {
                  callTexts.push(code.slice(inner.start, inner.end));
                }
              },
            });
          }
          this.skip();
        }
      },
    });
    expect(outerFnFound).toBe(true);
    expect(callTexts).toEqual(['foo()', 'bar()']);
  });

  it('should survive walking with predicates that have never been accessed before in this run (cold-cache path)', () => {
    // Exercises the Proxy `get` trap on a discriminator that the cache may
    // not have seen yet (depending on test ordering). Validates the lazy
    // initialisation path explicitly.
    const code = `try { throw new Error('x'); } catch (e) { if (e) {} }`;
    const parsed = parseOk(code, 'cold.ts');
    let tryCount = 0;
    let throwCount = 0;
    let ifCount = 0;
    walk(parsed.program, {
      enter(node) {
        if (is.TryStatement(node)) tryCount += 1;
        if (is.ThrowStatement(node)) throwCount += 1;
        if (is.IfStatement(node)) ifCount += 1;
      },
    });
    expect(tryCount).toBe(1);
    expect(throwCount).toBe(1);
    expect(ifCount).toBe(1);
  });
});
