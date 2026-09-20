# @patina/paint

GPU painting and portable CPU reference engine. ESM source package, version 0.1.0.

## Public API

`GPUPaintEngine`, `CPUPaintEngine`, `StrokeSampler`.

## Host contract

Requires @patina/materials and @patina/gpu. CPU numerical painting runs in Node; image decals need Canvas/createImageBitmap. Host records semantic strokes separately from paint() calls.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
