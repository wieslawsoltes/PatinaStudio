# @patina/baker

Geometry maps and self-occlusion baking. ESM source package, version 0.1.0.

## Public API

`computeCurvature`, `rasterizeGeometry`, `dilateMaps`, `bakeMaps`, `BakeWorker`.

## Host contract

Numeric routines run in Node or a worker. bakeMaps accepts an injected BVH constructor. BakeWorker needs an explicit mathURL because document import maps do not apply to its module graph.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
