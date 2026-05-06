import { describe, it, expect } from 'bun:test';
import type { Node } from 'oxc-parser';
import {
  getNodeHeader,
  isArrowFunctionExpression,
  isAssignmentExpression,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionNode,
  isIdentifier,
  isMemberExpression,
  isTSQualifiedName,
  isVariableDeclaration,
  getNodeName,
  getStringLiteralValue,
  getQualifiedName,
  is,
} from './ast-utils';

// Build a minimal Node-shaped value for runtime branch testing. The runtime
// predicates only inspect `.type`; the rest of the shape is irrelevant.
const asNode = (type: string, extra: Record<string, unknown> = {}): Node =>
  ({ type, ...extra }) as unknown as Node;

describe('getNodeHeader', () => {
  it('should return node.id.name when node is FunctionDeclaration-like', () => {
    const node = { type: 'FunctionDeclaration', id: { name: 'myFunc' } };
    expect(getNodeHeader(node)).toBe('myFunc');
  });

  it('should return node.key.name when node is MethodDefinition-like', () => {
    const node = { type: 'MethodDefinition', key: { name: 'render' } };
    expect(getNodeHeader(node)).toBe('render');
  });

  it('should use parent.id.name when parent is VariableDeclarator', () => {
    const node = { type: 'ArrowFunctionExpression' };
    const parent = { type: 'VariableDeclarator', id: { name: 'myArrow' } };
    expect(getNodeHeader(node, parent)).toBe('myArrow');
  });

  it('should fall back to "anonymous" when no name can be resolved', () => {
    const node = { type: 'ArrowFunctionExpression' };
    expect(getNodeHeader(node)).toBe('anonymous');
  });

  it('should handle string literal key when method key is computed string literal', () => {
    const node = { type: 'MethodDefinition', key: { type: 'StringLiteral', value: 'myMethod' } };
    expect(getNodeHeader(node)).toBe('myMethod');
  });

  it('should use parent.key.name when parent is MethodDefinition', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'MethodDefinition', key: { name: 'render' } };
    expect(getNodeHeader(node, parent)).toBe('render');
  });

  it('should use parent.key.name when parent is Property', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'Property', key: { name: 'handler' } };
    expect(getNodeHeader(node, parent)).toBe('handler');
  });
});

describe('isFunctionNode', () => {
  it('should return true when node type is FunctionDeclaration', () => {
    expect(isFunctionNode(asNode('FunctionDeclaration'))).toBe(true);
  });

  it('should return true when node type is FunctionExpression', () => {
    expect(isFunctionNode(asNode('FunctionExpression'))).toBe(true);
  });

  it('should return true when node type is ArrowFunctionExpression', () => {
    expect(isFunctionNode(asNode('ArrowFunctionExpression'))).toBe(true);
  });

  it('should return false when node type is ClassDeclaration', () => {
    expect(isFunctionNode(asNode('ClassDeclaration'))).toBe(false);
  });

  it('should return false when node type is Identifier', () => {
    expect(isFunctionNode(asNode('Identifier'))).toBe(false);
  });

  it('should return false when node type is TSDeclareFunction (Function-shape but excluded from this union)', () => {
    expect(isFunctionNode(asNode('TSDeclareFunction'))).toBe(false);
  });

  it('should return false when node type is TSEmptyBodyFunctionExpression (Function-shape but excluded from this union)', () => {
    expect(isFunctionNode(asNode('TSEmptyBodyFunctionExpression'))).toBe(false);
  });
});

describe('isArrowFunctionExpression', () => {
  it('should return true on ArrowFunctionExpression', () => {
    expect(isArrowFunctionExpression(asNode('ArrowFunctionExpression'))).toBe(true);
  });

  it('should return false on FunctionExpression', () => {
    expect(isArrowFunctionExpression(asNode('FunctionExpression'))).toBe(false);
  });

  it('should return false on FunctionDeclaration', () => {
    expect(isArrowFunctionExpression(asNode('FunctionDeclaration'))).toBe(false);
  });
});

describe('isAssignmentExpression', () => {
  it('should return true on AssignmentExpression', () => {
    expect(isAssignmentExpression(asNode('AssignmentExpression'))).toBe(true);
  });

  it('should return false on BinaryExpression', () => {
    expect(isAssignmentExpression(asNode('BinaryExpression'))).toBe(false);
  });

  it('should return false on UpdateExpression', () => {
    expect(isAssignmentExpression(asNode('UpdateExpression'))).toBe(false);
  });
});

describe('isCallExpression', () => {
  it('should return true on CallExpression', () => {
    expect(isCallExpression(asNode('CallExpression'))).toBe(true);
  });

  it('should return false on NewExpression (sibling, distinct discriminator)', () => {
    expect(isCallExpression(asNode('NewExpression'))).toBe(false);
  });

  it('should return false on TaggedTemplateExpression', () => {
    expect(isCallExpression(asNode('TaggedTemplateExpression'))).toBe(false);
  });
});

describe('isFunctionDeclaration', () => {
  it('should return true on FunctionDeclaration', () => {
    expect(isFunctionDeclaration(asNode('FunctionDeclaration'))).toBe(true);
  });

  it('should return false on FunctionExpression (same Function interface but distinct discriminator)', () => {
    expect(isFunctionDeclaration(asNode('FunctionExpression'))).toBe(false);
  });

  it('should return false on TSDeclareFunction (same Function interface but distinct discriminator)', () => {
    expect(isFunctionDeclaration(asNode('TSDeclareFunction'))).toBe(false);
  });

  it('should return false on ArrowFunctionExpression', () => {
    expect(isFunctionDeclaration(asNode('ArrowFunctionExpression'))).toBe(false);
  });
});

describe('isFunctionExpression', () => {
  it('should return true on FunctionExpression', () => {
    expect(isFunctionExpression(asNode('FunctionExpression'))).toBe(true);
  });

  it('should return false on FunctionDeclaration', () => {
    expect(isFunctionExpression(asNode('FunctionDeclaration'))).toBe(false);
  });

  it('should return false on TSEmptyBodyFunctionExpression (same Function interface but distinct discriminator)', () => {
    expect(isFunctionExpression(asNode('TSEmptyBodyFunctionExpression'))).toBe(false);
  });

  it('should return false on ArrowFunctionExpression', () => {
    expect(isFunctionExpression(asNode('ArrowFunctionExpression'))).toBe(false);
  });
});

describe('isIdentifier (6-way collision)', () => {
  // The "Identifier" discriminator is shared by IdentifierName,
  // IdentifierReference, BindingIdentifier, LabelIdentifier, TSThisParameter,
  // TSIndexSignatureName. All return true.
  it('should return true on a plain Identifier (covering all 6 backing interfaces)', () => {
    expect(isIdentifier(asNode('Identifier', { name: 'foo' }))).toBe(true);
  });

  it('should return true when the node carries TSThisParameter-shaped fields (decorators: [], optional: false, name: "this")', () => {
    expect(
      isIdentifier(
        asNode('Identifier', {
          name: 'this',
          decorators: [],
          optional: false,
          typeAnnotation: null,
        }),
      ),
    ).toBe(true);
  });

  it('should return true when the node carries TSIndexSignatureName-shaped fields', () => {
    expect(
      isIdentifier(
        asNode('Identifier', {
          name: 'idx',
          decorators: [],
          optional: false,
          typeAnnotation: null,
        }),
      ),
    ).toBe(true);
  });

  it('should return false on PrivateIdentifier (related but distinct discriminator)', () => {
    expect(isIdentifier(asNode('PrivateIdentifier'))).toBe(false);
  });

  it('should return false on ThisExpression', () => {
    expect(isIdentifier(asNode('ThisExpression'))).toBe(false);
  });
});

describe('isMemberExpression (3-way collision)', () => {
  // "MemberExpression" is shared by ComputedMemberExpression,
  // StaticMemberExpression, PrivateFieldExpression. All three carry .object.
  it('should return true on a static member expression (foo.bar) — StaticMemberExpression interface', () => {
    expect(
      isMemberExpression(
        asNode('MemberExpression', {
          object: { type: 'Identifier', name: 'foo' },
          property: { type: 'Identifier', name: 'bar' },
          computed: false,
          optional: false,
        }),
      ),
    ).toBe(true);
  });

  it('should return true on a computed member expression (foo[0]) — ComputedMemberExpression interface', () => {
    expect(
      isMemberExpression(
        asNode('MemberExpression', {
          object: { type: 'Identifier', name: 'foo' },
          expression: { type: 'NumericLiteral', value: 0 },
          computed: true,
          optional: false,
        }),
      ),
    ).toBe(true);
  });

  it('should return true on a private field expression (foo.#bar) — PrivateFieldExpression interface', () => {
    expect(
      isMemberExpression(
        asNode('MemberExpression', {
          object: { type: 'Identifier', name: 'foo' },
          field: { type: 'PrivateIdentifier', name: 'bar' },
          optional: false,
        }),
      ),
    ).toBe(true);
  });

  it('should return false on ChainExpression (related but distinct)', () => {
    expect(isMemberExpression(asNode('ChainExpression'))).toBe(false);
  });

  it('should return false on Identifier', () => {
    expect(isMemberExpression(asNode('Identifier'))).toBe(false);
  });
});

describe('isTSQualifiedName (2-way collision)', () => {
  // "TSQualifiedName" is shared by TSQualifiedName and
  // TSImportTypeQualifiedName. Both carry .left and .right.
  it('should return true on a regular TSQualifiedName (Foo.Bar)', () => {
    expect(
      isTSQualifiedName(
        asNode('TSQualifiedName', {
          left: { type: 'Identifier', name: 'Foo' },
          right: { type: 'Identifier', name: 'Bar' },
        }),
      ),
    ).toBe(true);
  });

  it('should return true on a TSImportTypeQualifiedName (import("x").Foo.Bar) — same discriminator, different .left shape', () => {
    expect(
      isTSQualifiedName(
        asNode('TSQualifiedName', {
          left: { type: 'TSImportType', argument: { type: 'TSLiteralType' } },
          right: { type: 'Identifier', name: 'Bar' },
        }),
      ),
    ).toBe(true);
  });

  it('should return false on TSTypeReference (different discriminator)', () => {
    expect(isTSQualifiedName(asNode('TSTypeReference'))).toBe(false);
  });

  it('should return false on Identifier', () => {
    expect(isTSQualifiedName(asNode('Identifier'))).toBe(false);
  });
});

describe('isVariableDeclaration', () => {
  it('should return true on VariableDeclaration', () => {
    expect(isVariableDeclaration(asNode('VariableDeclaration'))).toBe(true);
  });

  it('should return false on VariableDeclarator (related but distinct discriminator)', () => {
    expect(isVariableDeclaration(asNode('VariableDeclarator'))).toBe(false);
  });

  it('should return false on FunctionDeclaration', () => {
    expect(isVariableDeclaration(asNode('FunctionDeclaration'))).toBe(false);
  });
});

describe('predicates: REGRESSION — narrowing must not collapse to never (0.27.0 bug)', () => {
  // 0.27.0 used `Extract<Node, { type: 'X' }>`. For predicates whose backing
  // interface had a multi-literal `type` field (Function: 4-way, etc.),
  // distributive Extract collapsed to `never`. These tests assign a literal
  // to the narrowed `n.type` — if narrowing is `never`, the literal is not
  // assignable and tsc fails. They MUST live in a .spec.ts file so
  // `bun run typecheck` exercises them on every CI run.

  it('should narrow isFunctionDeclaration so that "FunctionDeclaration" is assignable to n.type', () => {
    const n = asNode('FunctionDeclaration');
    if (isFunctionDeclaration(n)) {
      const _t: 'FunctionDeclaration' = n.type;
      void _t;
    }
    expect(isFunctionDeclaration(n)).toBe(true);
  });

  it('should narrow isFunctionExpression so that "FunctionExpression" is assignable to n.type', () => {
    const n = asNode('FunctionExpression');
    if (isFunctionExpression(n)) {
      const _t: 'FunctionExpression' = n.type;
      void _t;
    }
    expect(isFunctionExpression(n)).toBe(true);
  });

  it('should narrow isFunctionDeclaration so that Function-interface fields (.params, .body, .id, .async) are accessible', () => {
    const n = asNode('FunctionDeclaration', {
      id: null,
      generator: false,
      async: false,
      params: [],
      body: null,
      expression: false,
    });
    if (isFunctionDeclaration(n)) {
      // If narrowed to never, every line below fails to compile.
      const _id = n.id;
      const _generator: boolean = n.generator;
      const _async: boolean = n.async;
      const _params = n.params;
      const _body = n.body;
      void _id;
      void _generator;
      void _async;
      void _params;
      void _body;
    }
    expect(isFunctionDeclaration(n)).toBe(true);
  });

  it('should narrow isFunctionExpression so that Function-interface fields are accessible', () => {
    const n = asNode('FunctionExpression');
    if (isFunctionExpression(n)) {
      const _params = n.params;
      const _body = n.body;
      const _id = n.id;
      void _params;
      void _body;
      void _id;
    }
    expect(isFunctionExpression(n)).toBe(true);
  });

  it('should narrow isFunctionNode so that all 3 backing literals are assignable to n.type', () => {
    const n = asNode('FunctionDeclaration');
    if (isFunctionNode(n)) {
      const _fd: 'FunctionDeclaration' = 'FunctionDeclaration' as 'FunctionDeclaration' & typeof n.type;
      const _fe: 'FunctionExpression' = 'FunctionExpression' as 'FunctionExpression' & typeof n.type;
      const _afe: 'ArrowFunctionExpression' = 'ArrowFunctionExpression' as 'ArrowFunctionExpression' & typeof n.type;
      void _fd;
      void _fe;
      void _afe;
      // .params is common across all 3 backing interfaces.
      const _params = n.params;
      void _params;
    }
    expect(isFunctionNode(n)).toBe(true);
  });

  it('should narrow isCallExpression so that .arguments / .callee / .optional are accessible', () => {
    const n = asNode('CallExpression');
    if (isCallExpression(n)) {
      const _t: 'CallExpression' = n.type;
      const _args = n.arguments;
      const _callee = n.callee;
      const _optional: boolean = n.optional;
      void _t;
      void _args;
      void _callee;
      void _optional;
    }
    expect(isCallExpression(n)).toBe(true);
  });

  it('should narrow isMemberExpression so that the union of 3 interfaces stays accessible (.object)', () => {
    const n = asNode('MemberExpression');
    if (isMemberExpression(n)) {
      const _t: 'MemberExpression' = n.type;
      const _obj = n.object;
      void _t;
      void _obj;
    }
    expect(isMemberExpression(n)).toBe(true);
  });

  it('should narrow isIdentifier so that .name is accessible across the 6-way union', () => {
    const n = asNode('Identifier');
    if (isIdentifier(n)) {
      const _t: 'Identifier' = n.type;
      const _name = n.name;
      void _t;
      void _name;
    }
    expect(isIdentifier(n)).toBe(true);
  });

  it('should narrow isTSQualifiedName so that .left / .right are accessible', () => {
    const n = asNode('TSQualifiedName');
    if (isTSQualifiedName(n)) {
      const _t: 'TSQualifiedName' = n.type;
      const _left = n.left;
      const _right = n.right;
      void _t;
      void _left;
      void _right;
    }
    expect(isTSQualifiedName(n)).toBe(true);
  });

  it('should narrow isAssignmentExpression so that .operator / .left / .right are accessible', () => {
    const n = asNode('AssignmentExpression');
    if (isAssignmentExpression(n)) {
      const _t: 'AssignmentExpression' = n.type;
      void _t;
    }
    expect(isAssignmentExpression(n)).toBe(true);
  });

  it('should narrow isVariableDeclaration so that "VariableDeclaration" is assignable to n.type', () => {
    const n = asNode('VariableDeclaration');
    if (isVariableDeclaration(n)) {
      const _t: 'VariableDeclaration' = n.type;
      void _t;
    }
    expect(isVariableDeclaration(n)).toBe(true);
  });

  it('should narrow isArrowFunctionExpression so that "ArrowFunctionExpression" is assignable to n.type', () => {
    const n = asNode('ArrowFunctionExpression');
    if (isArrowFunctionExpression(n)) {
      const _t: 'ArrowFunctionExpression' = n.type;
      void _t;
    }
    expect(isArrowFunctionExpression(n)).toBe(true);
  });
});

describe('predicates: type-level narrowing (compile-time only — failures show up at typecheck)', () => {
  it('should narrow within an isCallExpression branch so .arguments / .callee / .optional are accessible', () => {
    const n = asNode('CallExpression', {
      callee: { type: 'Identifier', name: 'fn' },
      arguments: [],
      optional: false,
    });
    if (isCallExpression(n)) {
      // The following must compile with the narrowed type. If the predicate
      // signature regresses, tsc will fail.
      const _args: typeof n.arguments = n.arguments;
      const _callee: typeof n.callee = n.callee;
      const _optional: boolean = n.optional;
      void _args;
      void _callee;
      void _optional;
    }
    expect(isCallExpression(n)).toBe(true);
  });

  it('should narrow within an isMemberExpression branch so the union accessor .object is reachable', () => {
    const n = asNode('MemberExpression', {
      object: { type: 'Identifier', name: 'a' },
      property: { type: 'Identifier', name: 'b' },
      computed: false,
      optional: false,
    });
    if (isMemberExpression(n)) {
      const _obj: typeof n.object = n.object;
      void _obj;
    }
    expect(isMemberExpression(n)).toBe(true);
  });

  it('should narrow within an isFunctionNode branch so .params is accessible across all 3 backing types', () => {
    const n = asNode('FunctionDeclaration', {
      id: null,
      generator: false,
      async: false,
      params: [],
      body: null,
      expression: false,
    });
    if (isFunctionNode(n)) {
      const _params: typeof n.params = n.params;
      void _params;
    }
    expect(isFunctionNode(n)).toBe(true);
  });

  it('should narrow within an isIdentifier branch so .name is accessible across all 6 backing interfaces', () => {
    const n = asNode('Identifier', { name: 'foo' });
    if (isIdentifier(n)) {
      const _name: typeof n.name = n.name;
      void _name;
    }
    expect(isIdentifier(n)).toBe(true);
  });

  it('should narrow within an isTSQualifiedName branch so .left and .right are accessible', () => {
    const n = asNode('TSQualifiedName', {
      left: { type: 'Identifier', name: 'A' },
      right: { type: 'Identifier', name: 'B' },
    });
    if (isTSQualifiedName(n)) {
      const _left: typeof n.left = n.left;
      const _right: typeof n.right = n.right;
      void _left;
      void _right;
    }
    expect(isTSQualifiedName(n)).toBe(true);
  });
});

describe('predicates: compositional invariants', () => {
  // isFunctionNode is a documented union of 3 individual predicates. The
  // invariant must hold for every Node literal we know.
  const literals = [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'CallExpression',
    'Identifier',
    'MemberExpression',
    'TSQualifiedName',
    'VariableDeclaration',
    'AssignmentExpression',
    'TSDeclareFunction',
    'TSEmptyBodyFunctionExpression',
    'ClassDeclaration',
    'Program',
  ];

  for (const lit of literals) {
    it(`should satisfy isFunctionNode(n) === isFunctionDeclaration(n) || isFunctionExpression(n) || isArrowFunctionExpression(n) for type=${lit}`, () => {
      const n = asNode(lit);
      const composed =
        isFunctionDeclaration(n) || isFunctionExpression(n) || isArrowFunctionExpression(n);
      expect(isFunctionNode(n)).toBe(composed);
    });
  }

  it('should never claim two distinct simple discriminators on the same node', () => {
    const n = asNode('CallExpression');
    const flags = [
      isCallExpression(n),
      isAssignmentExpression(n),
      isVariableDeclaration(n),
      isIdentifier(n),
      isMemberExpression(n),
      isTSQualifiedName(n),
      isFunctionDeclaration(n),
      isFunctionExpression(n),
      isArrowFunctionExpression(n),
    ];
    const trueCount = flags.filter(Boolean).length;
    expect(trueCount).toBe(1);
  });
});

describe('predicates: defensive runtime cases', () => {
  // The signatures require Node, but at runtime users may pass nodes whose
  // .type is unexpected (e.g. forward-incompatible oxc-parser releases).
  // Predicates must return false rather than throw.
  it('should return false for an unknown discriminator', () => {
    const n = asNode('SomeFutureNodeType');
    expect(isCallExpression(n)).toBe(false);
    expect(isIdentifier(n)).toBe(false);
    expect(isFunctionNode(n)).toBe(false);
  });

  it('should return false when the discriminator is an empty string', () => {
    const n = asNode('');
    expect(isCallExpression(n)).toBe(false);
    expect(isMemberExpression(n)).toBe(false);
  });
});

describe('getNodeName', () => {
  it('should return the name string when node has a string name property', () => {
    expect(getNodeName({ type: 'Identifier', name: 'foo' })).toBe('foo');
  });

  it('should return null when node has no name property', () => {
    expect(getNodeName({ type: 'Program' })).toBeNull();
  });

  it('should return null when input is non-object', () => {
    expect(getNodeName(42)).toBeNull();
    expect(getNodeName(null)).toBeNull();
  });

  it('should return null when name property is not a string', () => {
    expect(getNodeName({ name: 123 })).toBeNull();
  });
});

describe('getStringLiteralValue', () => {
  it('should return value when node is StringLiteral', () => {
    expect(getStringLiteralValue({ type: 'StringLiteral', value: 'hello' })).toBe('hello');
  });

  it('should return value when node is Literal with string value', () => {
    expect(getStringLiteralValue({ type: 'Literal', value: 'world' })).toBe('world');
  });

  it('should return null when node is Literal with numeric value', () => {
    expect(getStringLiteralValue({ type: 'Literal', value: 42 })).toBeNull();
  });

  it('should return null when node is Identifier', () => {
    expect(getStringLiteralValue({ type: 'Identifier', name: 'x' })).toBeNull();
  });

  it('should return null when non-object input is provided', () => {
    expect(getStringLiteralValue(null)).toBeNull();
    expect(getStringLiteralValue('raw string')).toBeNull();
  });
});

describe('getQualifiedName', () => {
  it('should return { root, parts: [], full } when node is Identifier', () => {
    const node = { type: 'Identifier', name: 'foo' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'foo', parts: [], full: 'foo' });
  });

  it('should return root "this" when node is ThisExpression', () => {
    const node = { type: 'ThisExpression' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'this', parts: [], full: 'this' });
  });

  it('should return root "super" when node is Super', () => {
    const node = { type: 'Super' };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'super', parts: [], full: 'super' });
  });

  it('should resolve a simple MemberExpression when node is a.b', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'a' },
      property: { type: 'Identifier', name: 'b' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'a', parts: ['b'], full: 'a.b' });
  });

  it('should resolve a nested MemberExpression when node is a.b.c', () => {
    const node = {
      type: 'MemberExpression',
      object: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'a' },
        property: { type: 'Identifier', name: 'b' },
        computed: false,
      },
      property: { type: 'Identifier', name: 'c' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'a', parts: ['b', 'c'], full: 'a.b.c' });
  });

  it('should return null when node is CallExpression', () => {
    const node = { type: 'CallExpression', callee: { type: 'Identifier', name: 'foo' } };
    expect(getQualifiedName(node)).toBeNull();
  });

  it('should return null when input is null', () => {
    expect(getQualifiedName(null)).toBeNull();
  });

  it('should resolve this.method when node combines ThisExpression and MemberExpression', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'ThisExpression' },
      property: { type: 'Identifier', name: 'method' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'this', parts: ['method'], full: 'this.method' });
  });

  it('should resolve super.method when node combines Super and MemberExpression', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'Super' },
      property: { type: 'Identifier', name: 'connect' },
      computed: false,
    };
    const result = getQualifiedName(node);
    expect(result).toEqual({ root: 'super', parts: ['connect'], full: 'super.connect' });
  });
});

describe('getNodeHeader (additional coverage)', () => {
  it('should return key.value when key is a StringLiteral', () => {
    const node = { type: 'PropertyDefinition', key: { type: 'StringLiteral', value: 'myProp' } };
    expect(getNodeHeader(node)).toBe('myProp');
  });

  it('should return key.value when key is a Literal with string value', () => {
    const node = { type: 'Property', key: { type: 'Literal', value: 'literalKey' } };
    expect(getNodeHeader(node)).toBe('literalKey');
  });

  it('should return parent key.value when parent is PropertyDefinition with string-valued key', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'PropertyDefinition', key: { value: 'computed' } };
    expect(getNodeHeader(node, parent)).toBe('computed');
  });

  it('should return anonymous when parent is MethodDefinition and pkey has no string name or value', () => {
    const node = { type: 'FunctionExpression' };
    const parent = { type: 'MethodDefinition', key: { name: 42, value: true } };
    expect(getNodeHeader(node, parent)).toBe('anonymous');
  });
});

describe('getQualifiedName (additional coverage)', () => {
  it('should return null when MemberExpression root object is a CallExpression', () => {
    const node = {
      type: 'MemberExpression',
      object: { type: 'CallExpression', callee: { type: 'Identifier', name: 'fn' } },
      property: { type: 'Identifier', name: 'result' },
      computed: false,
    };
    expect(getQualifiedName(node)).toBeNull();
  });
});

describe('is namespace: runtime positive matches across every Node["type"] discriminator', () => {
  // Every literal in oxc-parser Node['type'] union must round-trip through
  // is.X(asNode('X')) === true. Failing this for a known literal indicates
  // the Proxy lookup or caching path regressed.
  const literals = [
    // Top-level
    'Program',
    // Expressions
    'CallExpression',
    'NewExpression',
    'MemberExpression',
    'AssignmentExpression',
    'BinaryExpression',
    'LogicalExpression',
    'UnaryExpression',
    'UpdateExpression',
    'ConditionalExpression',
    'SequenceExpression',
    'ArrayExpression',
    'ObjectExpression',
    'ArrowFunctionExpression',
    'FunctionExpression',
    'YieldExpression',
    'AwaitExpression',
    'ChainExpression',
    'SpreadElement',
    'ThisExpression',
    'Super',
    'TaggedTemplateExpression',
    'TemplateLiteral',
    // Declarations
    'FunctionDeclaration',
    'ClassDeclaration',
    'VariableDeclaration',
    'VariableDeclarator',
    'ImportDeclaration',
    'ExportNamedDeclaration',
    'ExportDefaultDeclaration',
    'ExportAllDeclaration',
    // Statements
    'ReturnStatement',
    'IfStatement',
    'BlockStatement',
    'ExpressionStatement',
    'ForStatement',
    'WhileStatement',
    'TryStatement',
    'ThrowStatement',
    // Identifiers / literals
    'Identifier',
    'PrivateIdentifier',
    'StringLiteral',
    'NumericLiteral',
    'BooleanLiteral',
    'NullLiteral',
    // TS
    'TSQualifiedName',
    'TSDeclareFunction',
    'TSEmptyBodyFunctionExpression',
    'TSTypeReference',
    'TSInterfaceDeclaration',
    'TSTypeAliasDeclaration',
    'TSEnumDeclaration',
  ];

  for (const lit of literals) {
    it(`should return true on is.${lit}(asNode('${lit}'))`, () => {
      const fn = (is as unknown as Record<string, (n: Node) => boolean>)[lit];
      expect(typeof fn).toBe('function');
      expect(fn!(asNode(lit))).toBe(true);
    });

    it(`should return false on is.${lit}(asNode('Identifier')) when discriminator differs`, () => {
      if (lit === 'Identifier') return; // not a useful negation
      const fn = (is as unknown as Record<string, (n: Node) => boolean>)[lit];
      expect(fn!(asNode('Identifier'))).toBe(false);
    });
  }
});

describe('is namespace: equivalence with the hand-written predicates', () => {
  // For every hand-written predicate, is.X(node) must match isX(node) on every
  // probe in this list — including negative matches and the relevant collision
  // cases. This is the contract that justifies the migration story (named ↔
  // is.X are pointwise-equal).
  const probes = [
    'CallExpression',
    'NewExpression',
    'MemberExpression',
    'AssignmentExpression',
    'BinaryExpression',
    'ArrowFunctionExpression',
    'FunctionExpression',
    'FunctionDeclaration',
    'TSDeclareFunction',
    'TSEmptyBodyFunctionExpression',
    'Identifier',
    'PrivateIdentifier',
    'TSQualifiedName',
    'TSTypeReference',
    'VariableDeclaration',
    'VariableDeclarator',
    'ClassDeclaration',
    'Program',
    'ReturnStatement',
    'ImportDeclaration',
    'ExportNamedDeclaration',
    'ExportDefaultDeclaration',
    '',
    'SomeFutureNodeType',
  ];

  const pairs: Array<{ named: (n: Node) => boolean; key: string }> = [
    { named: isCallExpression, key: 'CallExpression' },
    { named: isMemberExpression, key: 'MemberExpression' },
    { named: isIdentifier, key: 'Identifier' },
    { named: isAssignmentExpression, key: 'AssignmentExpression' },
    { named: isArrowFunctionExpression, key: 'ArrowFunctionExpression' },
    { named: isFunctionDeclaration, key: 'FunctionDeclaration' },
    { named: isFunctionExpression, key: 'FunctionExpression' },
    { named: isTSQualifiedName, key: 'TSQualifiedName' },
    { named: isVariableDeclaration, key: 'VariableDeclaration' },
  ];

  for (const { named, key } of pairs) {
    it(`should match the hand-written is${key} runtime decision pointwise across the probe set`, () => {
      const proxyFn = (is as unknown as Record<string, (n: Node) => boolean>)[key]!;
      for (const lit of probes) {
        const node = asNode(lit);
        expect(proxyFn(node)).toBe(named(node));
      }
    });
  }
});

describe('is namespace: predicate function identity (caching)', () => {
  it('should return the same function reference across repeated property accesses', () => {
    const a = is.CallExpression;
    const b = is.CallExpression;
    expect(a).toBe(b);
  });

  it('should return distinct function references for distinct discriminators', () => {
    expect(is.CallExpression as unknown).not.toBe(is.NewExpression as unknown);
  });

  it('should remain stable when assigned and used as an Array#filter callback', () => {
    const filter = is.CallExpression;
    const nodes = [asNode('CallExpression'), asNode('Identifier'), asNode('CallExpression')];
    expect(nodes.filter(filter).length).toBe(2);
  });
});

describe('is namespace: defensive runtime cases', () => {
  it('should not satisfy the Promise thenable probe — `await Promise.resolve(is)` resolves to `is` itself within a tight deadline (regression: Proxy serving `then` deadlocks)', async () => {
    // If `is.then` returned a callable, V8 would treat `is` as a thenable and
    // invoke `then(resolve, reject)`. A predicate would ignore both callbacks
    // and return false → the promise would never settle. Guard with a 500ms
    // race; passing means `then` is unreachable as a callable.
    const result = await Promise.race([
      Promise.resolve(is).then((v) => (v === is ? 'self' : 'other')),
      new Promise<string>((resolve) => setTimeout(() => resolve('DEADLOCK'), 500)),
    ]);
    expect(result).toBe('self');
  });

  it('should return undefined for `is.then` so the Proxy does not present a thenable interface', () => {
    expect((is as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('should preserve `Object.prototype.toString` so `String(is)` returns "[object Object]" (regression: lowercase Proxy returns broke debug logging)', () => {
    expect(String(is)).toBe('[object Object]');
  });

  it('should preserve serialisation so `JSON.stringify(is)` returns "{}" (regression: Proxy `toJSON` predicate broke logging)', () => {
    expect(JSON.stringify(is)).toBe('{}');
  });

  it('should return undefined for lowercase typos so users see TypeError instead of silent false (e.g. `is.callExpression` is a typo for `is.CallExpression`)', () => {
    expect((is as unknown as Record<string, unknown>).callExpression).toBeUndefined();
    expect((is as unknown as Record<string, unknown>).identifier).toBeUndefined();
  });

  it('should return undefined for symbol property access (Symbol.iterator / Symbol.toPrimitive)', () => {
    expect((is as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    expect((is as unknown as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined();
  });

  it('should return undefined for Object.prototype-shadowing string keys so the prototype chain stays intact', () => {
    // These all start lowercase and are filtered to fall through to
    // Reflect.get on the empty target → returns whatever Object.prototype
    // exposes (which is the actual function, not a fake predicate).
    const probe = is as unknown as Record<string, unknown>;
    expect(typeof probe.toString).toBe('function');
    expect(typeof probe.valueOf).toBe('function');
    expect(typeof probe.hasOwnProperty).toBe('function');
    // `constructor` resolves to Object via prototype chain.
    expect(probe.constructor).toBe(Object);
  });

  it('should return false (not throw) when the input is null', () => {
    expect((is.CallExpression as (n: unknown) => boolean)(null)).toBe(false);
  });

  it('should return false (not throw) when the input is undefined', () => {
    expect((is.CallExpression as (n: unknown) => boolean)(undefined)).toBe(false);
  });

  it('should return false when the input is a primitive number', () => {
    expect((is.CallExpression as (n: unknown) => boolean)(42)).toBe(false);
  });

  it('should return false when the input is an empty object', () => {
    expect((is.CallExpression as (n: unknown) => boolean)({})).toBe(false);
  });

  it('should return false when the input has a non-string type field', () => {
    expect((is.CallExpression as (n: unknown) => boolean)({ type: 42 })).toBe(false);
    expect((is.CallExpression as (n: unknown) => boolean)({ type: null })).toBe(false);
  });
});

describe('is namespace: type-level narrowing (compile-time only)', () => {
  // These tests fail at `bun run typecheck` if the IsNamespace mapped type
  // regresses. They mirror the existing handful of regression tests for the
  // hand-written predicates.

  it('should narrow is.CallExpression so .arguments / .callee / .optional are accessible', () => {
    const n = asNode('CallExpression', {
      callee: { type: 'Identifier', name: 'fn' },
      arguments: [],
      optional: false,
    });
    if (is.CallExpression(n)) {
      const _t: 'CallExpression' = n.type;
      const _args = n.arguments;
      const _callee = n.callee;
      const _optional: boolean = n.optional;
      void _t;
      void _args;
      void _callee;
      void _optional;
    }
    expect(is.CallExpression(n)).toBe(true);
  });

  it('should narrow is.NewExpression so .arguments / .callee are accessible', () => {
    const n = asNode('NewExpression');
    if (is.NewExpression(n)) {
      const _t: 'NewExpression' = n.type;
      const _args = n.arguments;
      const _callee = n.callee;
      void _t;
      void _args;
      void _callee;
    }
    expect(is.NewExpression(n)).toBe(true);
  });

  it('should narrow is.ClassDeclaration so .id / .body are accessible', () => {
    const n = asNode('ClassDeclaration');
    if (is.ClassDeclaration(n)) {
      const _t: 'ClassDeclaration' = n.type;
      void _t;
    }
    expect(is.ClassDeclaration(n)).toBe(true);
  });

  it('should narrow is.ImportDeclaration so .source is accessible', () => {
    const n = asNode('ImportDeclaration');
    if (is.ImportDeclaration(n)) {
      const _t: 'ImportDeclaration' = n.type;
      void _t;
    }
    expect(is.ImportDeclaration(n)).toBe(true);
  });

  it('should narrow is.ExportNamedDeclaration so the literal type matches', () => {
    const n = asNode('ExportNamedDeclaration');
    if (is.ExportNamedDeclaration(n)) {
      const _t: 'ExportNamedDeclaration' = n.type;
      void _t;
    }
    expect(is.ExportNamedDeclaration(n)).toBe(true);
  });

  it('should narrow is.ExportDefaultDeclaration so the literal type matches', () => {
    const n = asNode('ExportDefaultDeclaration');
    if (is.ExportDefaultDeclaration(n)) {
      const _t: 'ExportDefaultDeclaration' = n.type;
      void _t;
    }
    expect(is.ExportDefaultDeclaration(n)).toBe(true);
  });

  it('should narrow is.ReturnStatement so .argument is accessible', () => {
    const n = asNode('ReturnStatement');
    if (is.ReturnStatement(n)) {
      const _t: 'ReturnStatement' = n.type;
      void _t;
    }
    expect(is.ReturnStatement(n)).toBe(true);
  });

  it('should narrow is.Identifier preserving the 6-way collision union (.name accessible)', () => {
    const n = asNode('Identifier', { name: 'foo' });
    if (is.Identifier(n)) {
      const _t: 'Identifier' = n.type;
      const _name = n.name;
      void _t;
      void _name;
    }
    expect(is.Identifier(n)).toBe(true);
  });

  it('should narrow is.MemberExpression preserving the 3-way collision union (.object accessible)', () => {
    const n = asNode('MemberExpression');
    if (is.MemberExpression(n)) {
      const _t: 'MemberExpression' = n.type;
      const _obj = n.object;
      void _t;
      void _obj;
    }
    expect(is.MemberExpression(n)).toBe(true);
  });

  it('should narrow is.TSQualifiedName preserving the 2-way collision union (.left / .right accessible)', () => {
    const n = asNode('TSQualifiedName');
    if (is.TSQualifiedName(n)) {
      const _t: 'TSQualifiedName' = n.type;
      const _left = n.left;
      const _right = n.right;
      void _t;
      void _left;
      void _right;
    }
    expect(is.TSQualifiedName(n)).toBe(true);
  });

  it('should narrow is.ClassDeclaration so Class-interface fields stay accessible (regression — Class is multi-literal: ClassDeclaration | ClassExpression)', () => {
    const n = asNode('ClassDeclaration', {
      id: null,
      superClass: null,
      body: { type: 'ClassBody', body: [] },
      decorators: [],
      typeParameters: null,
      superTypeArguments: null,
      implements: [],
      abstract: false,
      declare: false,
    });
    if (is.ClassDeclaration(n)) {
      const _id = n.id;
      const _super = n.superClass;
      const _body = n.body;
      const _decorators = n.decorators;
      const _abstract: boolean | undefined = n.abstract;
      void _id;
      void _super;
      void _body;
      void _decorators;
      void _abstract;
    }
    expect(is.ClassDeclaration(n)).toBe(true);
  });

  it('should narrow is.ClassExpression so Class-interface fields stay accessible (the OTHER literal of the Class multi-literal)', () => {
    const n = asNode('ClassExpression');
    if (is.ClassExpression(n)) {
      const _t: 'ClassExpression' = n.type;
      const _id = n.id;
      const _body = n.body;
      void _t;
      void _id;
      void _body;
    }
    expect(is.ClassExpression(n)).toBe(true);
  });

  it('should narrow is.FunctionExpression so Function-interface fields stay accessible (regression — Function is 4-way multi-literal)', () => {
    const n = asNode('FunctionExpression');
    if (is.FunctionExpression(n)) {
      const _params = n.params;
      const _body = n.body;
      const _id = n.id;
      const _async: boolean = n.async;
      const _generator: boolean = n.generator;
      void _params;
      void _body;
      void _id;
      void _async;
      void _generator;
    }
    expect(is.FunctionExpression(n)).toBe(true);
  });

  it('should narrow is.FunctionDeclaration so Function-interface fields stay accessible (regression for never-collapse)', () => {
    const n = asNode('FunctionDeclaration', {
      id: null,
      generator: false,
      async: false,
      params: [],
      body: null,
      expression: false,
    });
    if (is.FunctionDeclaration(n)) {
      const _params = n.params;
      const _body = n.body;
      const _id = n.id;
      void _params;
      void _body;
      void _id;
    }
    expect(is.FunctionDeclaration(n)).toBe(true);
  });
});
