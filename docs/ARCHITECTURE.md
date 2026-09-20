# Architecture and package contracts

## Dependency direction

```text
app/main.js + app/views.js + app/style.css
  ├─ @patina/project  semantic state, validation, history, local store
  ├─ @patina/ui       editor primitives and opt-in style foundation
  ├─ @patina/mesh ── @patina/math
  ├─ @patina/io ──── @patina/mesh + @patina/math
  ├─ @patina/materials
  ├─ @patina/paint ─ @patina/materials + @patina/gpu
  ├─ @patina/renderer ─ @patina/math
  └─ @patina/baker   BVH constructor injected; worker imports a supplied math URL
```

These are native ES modules, with browser resolution through an import map and Node resolution through npm workspace links. No package imports application code. The UI package's optional `styles.css` defines global editor defaults; import it explicitly in the host. The app supplies product-specific layout and views separately.

## Semantic state versus device resources

`Project` is portable plain data. Its ordered layers define the complete material. GPU objects never enter the project, IndexedDB or JSON checkpoints. `GPUPaintEngine`/`CPUPaintEngine` reconstruct a layer from its procedural material or embedded raster, then replay paint strokes, then mask strokes.

Each layer caches a content signature. Opacity, blend mode, visibility and procedural generator changes require recomposition, not brush replay. A content edit invalidates the layer cache. Completed live strokes mark their current resource cache as synchronized; undo/redo deliberately rebuilds from saved semantic state. This avoids losing the source of truth on device loss.

`History` stores before-edit JSON checkpoints with branch-aware redo, a 40-checkpoint default and approximately 64 MiB past-history guard. It is a semantic snapshot history rather than a tile-diff system. Large stroke/image histories still cost memory and replay time; the design leaves room for persistent tiles and periodic replay checkpoints.

## Core mesh contract

```js
const mesh = {
  name: 'UV mesh',
  positions: new Float32Array(/* xyz per vertex */),
  normals: new Float32Array(/* xyz per vertex */),
  uvs: new Float32Array(/* uv per vertex, v=0 at top */),
  indices: new Uint32Array(/* triangle-list vertex indices */)
};
```

OBJ's V coordinate is converted on import/export. GLB UVs follow its image convention directly. The application normalizes imported geometry; `validateMesh` checks finite arrays and bounds. Serialized mesh indices are validated before conversion, so fractional or negative JSON indices cannot become apparently valid unsigned values silently.

`BVH.hit(origin, direction, maxDistance?, ignoreTriangle?)` returns the nearest surface intersection with interpolated UV and normal. World-X symmetry mirrors the ray and performs a second real intersection. Stamping uses interpolated UVs and therefore does not implement a world-space projective brush footprint.

## Painting contract

```js
const engine = await new CPUPaintEngine(null, 256).init();
// GPU: new GPUPaintEngine(gpuContext, 256).init()
await engine.sync(project);
engine.paint(layerId, {
  mode: 0, // 0 paint, 1 erase, 2 mask white, 3 mask black
  settings: {
    radius: 0.04, color: '#d6bc82', metallic: 0.8,
    roughness: 0.37, height: 0.515, hardness: 0.3,
    flow: 0.65, shape: 0, spacing: 0.16,
    pressureSize: true, pressureOpacity: true
  },
  points: [[0.5, 0.5, 1]]
}, [[0.5, 0.5, 1]]);
renderer.setMaps(engine.composite(project));
const pixels = await engine.read();
engine.dispose();
```

`paint` updates cached pixels; a host must also append the stroke record to the corresponding project layer for persistence. `StrokeSampler` resamples distance into pressure-aware stamps and resets across large UV jumps. It avoids drawing a line across a seam, but is not a full seam-aware neighborhood duplication system.

CPU `composite()` returns typed pixel maps; GPU `composite()` returns textures. Both `read()` methods return `{color, aux, normal, resolution}` with RGBA8 byte arrays. Renderer selection must match this resource contract. GPU textures are not passed to GL/software renderers.

## GPU execution

There are four compute kernels, using 8×8 workgroups:

1. Fill generation evaluates procedural base color and material data into color/auxiliary/mask textures.
2. Brush rasterization reads the previous three layer textures and writes three ping-pong textures. Up to 64 stamps share a storage-buffer batch. Dispatch is bounded to their texture-space damage rectangle. Undamaged texels are preserved by whole-texture copies before the bounded dispatch.
3. Layer composition walks visible layers bottom-to-top through alternating composite textures. It multiplies painted masks with selected geometry/procedural generators, applies linear-light blend approximations, and writes final material channels and baked AO.
4. Height-to-normal samples adjacent height texels and derives a tangent-space normal texture.

Bindings are explicit in WGSL; pipelines use automatic compute layouts. `GPUContext.module` checks compilation diagnostics, the device captures uncaught validation errors, and `read()` pads rows to WebGPU's copy alignment before stripping padding for exported pixels.

The renderer uses indexed PBR draws, an analytic background/studio pass, a UV pass and optional line-list wireframe. A 256-byte camera buffer contains view-projection/inverse matrices and lighting/display values. The background evaluates screen derivatives outside nonuniform branches. The wireframe pipeline does not apply depth bias to non-triangle primitives.

GPU resources are explicitly destroyed on rebuild/disposal. The application estimates `(layerCount × 6 + 10) × resolution² × 4` bytes as a conservative texture budget and rejects requests above 768 MiB. This is not virtual texturing. Shader compilation and device loss are surfaced, not relabeled as successful GPU work.

## Baking

`rasterizeGeometry(mesh, resolution)` maps mesh triangles into a normalized UV tile with barycentric interpolation. Geometry texels encode world normal XYZ and signed curvature; the auxiliary mesh map encodes AO, normalized position Y, coverage and alpha. Full floating-point positions/normals and triangle IDs are retained during AO calculation.

`computeCurvature` welds coincident positions, accumulates neighborhood Laplacian information and projects it along the vertex normal. This gives a usable geometric signal, not a production high-poly curvature bake. Ambient occlusion traces cosine-weighted hemisphere rays against the current mesh BVH, excluding the source triangle. Four dilation passes extend samples into gutters.

`BakeWorker.run(mesh, options, onProgress)` isolates CPU tracing. It is intentionally not called a GPU bake. The module worker imports its own package relatively, and resolves the BVH constructor from an explicit absolute `mathURL`; document import maps do not implicitly configure module workers. `cancel()` terminates the worker and rejects with AbortError.

## Export

The I/O package encodes PNG through browser Canvas APIs, packs maps into a standards-structured uncompressed ZIP with CRC32 and central directory, and emits glTF 2.0 binary assets with embedded PNG buffer views. GLB export contains base color, ORM and +Y normal textures with the mesh. It does not include height displacement in the GLB material.

PNG and GLB texture encoding need browser Canvas/OffscreenCanvas; mesh parsing, ZIP packing, numeric channel utilities and the CPU paint core can be used in Node without the app. The standalone Node example writes a standard PPM image without depending on a browser image encoder.

## Extension boundaries

Additional texture sets belong above the single-set paint engine, with one engine/cache per set and explicit material-slot dispatch. UDIM support requires addressing and export schema changes rather than merely allowing UVs outside 0–1. Projective painting needs geometric footprint rasterization and seam duplication. High-to-low baking needs separate source/target BVHs and cage/ray-distance semantics. A richer layer system should replace positional layer iteration with a typed material/filter graph while preserving semantic persistence and resource independence.

These are architecture extension points, not features claimed to exist in this release.
