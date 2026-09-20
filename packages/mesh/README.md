# @patina/mesh

Indexed meshes, procedural geometry and Wavefront OBJ. ESM source package, version 0.1.0.

## Public API

`validateMesh`, `calculateNormals`, `fitMesh`, `createArtifact`, `createSphere`, `createCube`, `createTorus`, `primitives`, `parseOBJ`, `exportOBJ`, `serializeMesh`, `deserializeMesh`.

## Host contract

Requires @patina/math. Static triangle meshes, complete normals and UVs; the application limits UVs to one tile.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
