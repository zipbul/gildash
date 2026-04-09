---
"@zipbul/gildash": patch
---

fix: replace fs.promises.glob with Bun.Glob.scan({ followSymlinks: false })

Fixes ELOOP (too many symbolic links) error in monorepos with Bun workspace symlinks. Both file-indexer and project-discovery now use `Bun.Glob.scan` with `followSymlinks: false`, preventing infinite symlink cycle traversal. This also aligns with the project's Bun-first convention.
