# @zipbul/codeledger

A Bun-first TypeScript code indexer with symbol search, relation search, and dependency graph APIs.

## Install

```bash
bun add @zipbul/codeledger
```

## Quick Start

```ts
import { Codeledger } from '@zipbul/codeledger';

const ledger = await Codeledger.open({
	projectRoot: '/absolute/path/to/project',
});

const symbols = ledger.searchSymbols({ text: 'UserService' });
const deps = ledger.getDependencies('src/app.ts');

await ledger.close();
```

## API

- `Codeledger.open(options)`
- `searchSymbols(query)`
- `searchRelations(query)`
- `getDependencies(filePath, project?)`
- `getDependents(filePath, project?)`
- `getAffected(changedFiles, project?)`
- `hasCycle(project?)`
- `reindex()`

## Runtime

- Bun `v1.3+`
- TypeScript sources: `.ts`, `.mts`, `.cts`

## Testing

```bash
bun test
```

```bash
bun run coverage
```

## Project Docs

- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Changelog](./CHANGELOG.md)
