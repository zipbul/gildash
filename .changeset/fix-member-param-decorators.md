---
"@zipbul/gildash": patch
---

fix: extract method decorators and fix parameter decorator source location

- Method/abstract method decorators were not extracted in `extractClassMembers` — now populated
- `TSParameterProperty` decorators were read from `tsp.parameter.decorators` (always empty) instead of `tsp.decorators` — fixed
- Add `Parameter.typeImportSource` for import specifier of the parameter's type annotation
