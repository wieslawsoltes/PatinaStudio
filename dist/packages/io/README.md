# @patina/io

Portable mesh/material interchange. ESM source package, version 0.1.0.

## Public API

`parseGLB`, `exportGLB`, `encodePNG`, `exportTextureBundle`, `zipFiles`, `crc32`, `packORM`, `channelPixels`, `flipNormalY`, `download`, `nodeMatrix`.

## Host contract

Numeric/ZIP/mesh routines work in Node. PNG and textured GLB encoding require browser Canvas; download requires the DOM. GLB imports static geometry, not pre-existing materials.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
