---
"@zipbul/gildash": minor
---

React/JSX first-class support.

- Default indexed extensions now include `.tsx` (single `DEFAULT_EXTENSIONS`
  constant, previously drifting across three sites). `.jsx` stays opt-in via
  `extensions` — consistent with `.js` not being indexed by a TypeScript engine.
- `resolveImport` follows TypeScript 5.8's actual resolution table:
  extensionless imports probe `.ts` → `.tsx` → `.d.ts` → `.jsx` → `/index.*`
  (files before directories); `./x.js` maps to `x.ts`/`x.tsx`/`x.d.ts`;
  `./x.jsx` maps to `x.tsx`/`x.ts`/`x.d.ts`/`x.jsx`; explicit `./x.tsx`
  resolves as-is (previously produced bogus `x.tsx.ts` candidates — bug fix).
- JSX component usage (`<Button/>`, `<Ns.Card/>`) is captured as a `calls`
  relation with `metaJson: {"syntax":"jsx"}` — zero schema change. Intrinsic
  detection follows TS `isIntrinsicJsxName` (lowercase-first or dash-containing
  tags are hosts; `$W`/`_X` are components). Computed/factory tags are not
  captured (documented limit).
- The semantic layer answers on `.tsx` under each project's own `jsx` compiler
  option (multi-tsconfig, since 0.35.0). Angular decorators pinned by a
  regression fixture.

Behavioral note: `.tsx` files are now indexed by default; pass `extensions`
explicitly to keep the previous set.
