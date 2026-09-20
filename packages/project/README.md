# @patina/project

Semantic project storage and history. ESM source package, version 0.1.0.

## Public API

`createProject`, `newLayer`, `validateProject`, `History`, `ProjectStore`, `uuid`, `FORMAT`, `VERSION`.

## Host contract

Project/history work without a DOM. ProjectStore needs an IndexedDB-capable browser origin. GPU resources never enter serialized state.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
