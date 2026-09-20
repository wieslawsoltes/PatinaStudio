# Feature matrix — PatinaStudio 0.1

“Implemented” describes executable source in this release. It is not a statement that every backend has been validated on hardware. Consult VERIFICATION.md for tests actually run.

| Area | Implemented | Boundary |
|---|---|---|
| Painting | Model/UV pointer painting, ray/BVH picking, pressure size and opacity, spacing, six brush shapes, erasing | UV-space stamps, not projective world-footprint painting; no clone/smudge tool |
| Stroke storage | Semantic settings plus normalized pressure stamps; replay across resolutions | No topology-independent stroke reprojection |
| Symmetry | Mirrored world-X rays for 3D strokes | Not radial or arbitrary-plane symmetry; not applied to direct UV strokes |
| Layers | Fill/paint, visibility, opacity, normal/multiply/screen/overlay/add, per-channel toggles, reorder, duplicate, delete | No folders, pass-through groups, anchor references or adjustment/filter graph |
| Masks | White/black raster masks, additive/erasing mask strokes, mask fill, procedural generators | No polygon-ID fill, stencil projection, arbitrary effect graph or smart-mask asset format |
| Materials | Twelve procedural presets; editable color, metallic, roughness, height, scale, detail | No SBSAR loading, node authoring, external texture-slot material importer or material-library server |
| Decals | Raster image import; text rasterization; UV positioning, text rotation; independent editable layers | No screen-space projection cage or vector decal transform retained after rasterization |
| Meshes | Original study, sphere, torus, cube; OBJ polygon triangulation/negative indices; static embedded GLB scene geometry | Complete UVs required; one normalized tile; no auto-unwrap, FBX, USD, skins, animation, morphs, Draco or meshopt |
| Mesh baking | UV-space position/normal maps, welded curvature, BVH cosine-hemisphere self-AO, dilation, worker cancellation/progress | CPU worker, not GPU AO tracing; no high-to-low cage projection, thickness, bent normals or tangent-basis matching to MikkTSpace |
| Normal generation | GPU/CPU height gradients into tangent-space normal maps | Not painted independent normals, displacement tessellation, normal blending or 16-bit height |
| WebGPU view | GGX direct lighting, analytic reflected studio environment, ACES-like tone mapping, MSAA, debug channels, wireframe, orbit/pan/zoom | Analytic environment, not imported HDRI cubemaps/prefiltered IBL; no path tracer |
| Fallback views | WebGL2 plus CPU painting; software depth-buffered perspective-correct rasterization and bump detail | Preview quality/performance differ; environment switching and wireframe disabled |
| Color | Linear-light blend approximation, explicit exported color/data conventions | 2.2 gamma approximation; no ICC, OCIO, ACEScg working space or exact sRGB transfer |
| Projects | Portable versioned JSON, embedded geometry/decals/bakes/strokes, IndexedDB autosave, bounded history | No `.spp`, `.sbsar`, cloud collaboration, multi-document tabs or migration from other products |
| Export | Seven PNG maps, ORM packing, +Y/−Y normals, ZIP+manifest, embedded-texture GLB, OBJ geometry, viewport PNG | PNG RGBA8 only; no EXR, PSD, TIFF, DDS/BCn, atlas/UDIM export sets or custom export graph |
| UI | Original professional dark editor, split 3D/UV, assets and search, layers/properties, shortcuts, commands, resizable inspector | Original interface rather than pixel-identical Adobe UI; desktop-first, no full touch/VoiceOver audit |
| Performance | Bounded brush dispatch, 64-stamp batching, GPU-resident textures, coalesced render requests, worker AO, conservative memory guard | Full-texture ping-pong copies per brush batch and full-stack composition; no sparse virtual textures, mipstreaming or tiled history |

## Explicit parity gaps

This is a functional, limited material-painting editor and modular engine distribution. It is not a complete reproduction of commercial Substance 3D Painter. Major absent systems include multiple texture sets/UDIMs, automatic UV generation, triplanar/projective painting, high-to-low mesh baking, material-ID polygon fill, layer groups/anchors/filter graphs, clone/smudge tools, independent normal/emissive/opacity painting, HDR/16-bit pipelines and proprietary Adobe formats.

## Import contract

OBJ and GLB import bring in geometry with normals and UVs. GLB material textures are not imported. The mesh is normalized to a two-unit maximum extent. Imported UVs must stay within 0–1. Existing project layers are preserved when replacing the mesh, so different UV layouts can produce different visible placement; no claim of automatic repainting/reprojection is made.

Projects reject unexpected versions, invalid IDs, CSS-like color values, non-raster or remote decal URLs, invalid PBR numbers, malformed baked maps, nonfinite mesh data, fractional/out-of-range indices, and unsupported primitive names before replay. This is defensive validation, not a completed hostile-input fuzz/security audit.
