# @patina/renderer

Material viewport renderers. ESM source package, version 0.1.0.

## Public API

`GPURenderer`, `GLRenderer`, `SoftwareRenderer`; `meshWGSL`, `fullscreenWGSL`, `commonWGSL` via @patina/renderer/shaders.

## Host contract

Browser Canvas required. Match GPU textures to GPURenderer and CPU pixel maps to GLRenderer/SoftwareRenderer. Software rasterization is a bounded compatibility preview.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
