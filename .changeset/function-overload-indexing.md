---
"@zipbul/gildash": patch
---

fix: index function overload signatures consistently with method overloads

TSDeclareFunction nodes (function overload signatures) are now extracted as separate symbols, matching the existing behavior for method overloads in classes. Previously only the implementation signature was indexed for functions.
