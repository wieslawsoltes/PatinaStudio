# PatinaStudio

**Give surfaces a story.** An original, local-first HTML/CSS/JavaScript material-painting studio with a native WebGPU compute backend and separately reusable engine packages.

This repository contains a working editor, not a screenshot mockup. Brush strokes change material textures; masks and procedural fills compose into the surface; exported PNG maps and GLB assets contain those actual pixels. The included Artifact 07 study is generated locally from geometry and procedural materials.

**Release: 0.1.0, experimental.** This is not commercial Substance 3D Painter feature parity. There is no Adobe code, branding, asset dependency, `.spp` reader, or `.sbsar` runtime. See [the feature matrix](docs/FEATURES.md) and [the verification report](docs/VERIFICATION.md) for precise boundaries.

## Run

Install Node.js 20 or later, then:

```sh
cd PatinaStudio
npm start
# Open http://localhost:4173
```

The application has **zero external runtime dependencies**. `npm install` is not required just to run the static app. The browser resolves the ten local packages through the import map in `index.html`.

For package development and tests:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
node scripts/serve.mjs --dist
```

Use localhost or HTTPS, rather than opening `index.html` with `file://`. WebGPU is the primary backend. When an adapter is unavailable, the app uses CPU painting with WebGL2; when WebGL2 is unavailable too, it uses an explicitly labeled software rasterizer. The software renderer is a compatibility preview, not a production-performance substitute for the GPU renderer.

To exercise the GPU directly, open:

```text
http://localhost:4173/examples/gpu-validation.html
```

This page compiles all compute and rendering pipelines, compares simple CPU/GPU results, tests masks and worker baking, and downloads its actual report. It fails explicitly when there is no adapter.

## First material

The editor opens with the Artifact 07 study: aged copper, oxidation, exposed metal, a studio signature, and an empty paint layer. Drag on the object or its UV view to paint. The selected paint layer records color, metallic, roughness, and height together.

Use **Alt + drag** or the right mouse button to orbit, **Shift + drag** or the middle button to pan, the wheel to zoom, and **F** to frame the model. Use **B** for paint, **E** for erase, **I** to sample all paint channels, **H** for navigation, **M** for mask painting, and **X** for world-X symmetry. The bracket keys adjust brush size. The **1 / 2 / 3** keys select 3D, UV, and split layouts.

Click an asset to change the selected fill material or add a new fill above a paint layer. Fill layers remain procedural; paint on a paint layer or a fill layer's mask instead. Double-click a layer name to rename it; drag layers to reorder them. A black painted mask hides the layer and a white mask reveals it.

Use **Bake mesh maps** for actual self-occlusion ray tracing. Use **Export textures** to obtain seven PNG maps plus a packing manifest, or export a GLB containing the mesh and its material textures. Save a `.patina` file for a portable, editable project. Local autosave uses IndexedDB; the UI reports storage errors rather than pretending a save succeeded.

## Standalone packages

| Package | Responsibility |
| --- | --- |
| `@patina/math` | Vectors, matrices, orbit camera, ray/triangle intersection, BVH picking |
| `@patina/mesh` | Indexed mesh model, validation, procedural models, OBJ import/export |
| `@patina/materials` | Procedural PBR material evaluation, presets, brushes, material previews |
| `@patina/project` | Versioned semantic project, validation, undo/redo checkpoints, IndexedDB store |
| `@patina/gpu` | Device/resources, shader compilation, aligned readback, WGSL compute kernels |
| `@patina/paint` | Pressure resampling, GPU/CPU painting, masks, layer compositing, derived normals |
| `@patina/renderer` | WebGPU PBR, studio/UV rendering, wireframe, WebGL2 and software fallbacks |
| `@patina/baker` | UV rasterization, welded curvature, BVH ambient occlusion, dilation, worker host |
| `@patina/io` | PNG export, ZIP/CRC32, ORM packing, GLB geometry import and textured GLB export |
| `@patina/ui` | SVG icons, dialogs, command palette, toasts, splitter and reusable editor styles |

The editor consumes these packages rather than maintaining a second private implementation. Each has its own `package.json`, explicit dependencies, ESM exports, README and MIT license. They are source packages, not claims of published npm releases. Prepacked local tarballs are included in `archives/` in the distribution ZIP.

```sh
# From the distribution root, in another project:
npm install /absolute/path/to/PatinaStudio/archives/*.tgz
```

See [architecture and package contracts](docs/ARCHITECTURE.md) and [the standalone Node example](examples/library-usage.mjs).

## Project and export conventions

One normalized UV tile and one texture set are supported. Resolution is selectable from 256, 512, 1024 and 2048. Layers are bottom-to-top; the UI shows the topmost layer first. The 24-layer cap and conservative 768 MiB texture budget are deliberate resource guards; at 2048² the memory guard reduces the allowable layer count.

The project is the source of truth. It contains semantic layer parameters, pressure-stamped stroke records, embedded PNG decals, the primitive or serialized mesh, and optional baked maps. GPU textures are reconstructible caches. Undo, redo and project loading rebuild the surface from this data. Changing resolution rerasterizes normalized strokes rather than scaling a previously flattened bitmap.

Base color is exported as sRGB-encoded bytes. Metallic, roughness, height, AO and normals are data textures. Internally the auxiliary texture stores **R=metallic, G=roughness, B=height, A=AO** after composition. Exported ORM is **R=AO, G=roughness, B=metallic**. Height uses a midpoint of 0.5. Normal export supports OpenGL +Y or DirectX −Y; GLB uses +Y.

The rendering approximation converts color with a 2.2 power curve, not the exact piecewise sRGB transfer function. Height and normals are RGBA8-derived data, not a 16/32-bit displacement workflow. These choices are documented rather than presented as color-managed production equivalence.

## Validation status

The delivered implementation passed 35 Node tests and 19 Chromium UI/software-backend checks, including actual painting, mask pixels, history replay, decal replay, export contents and GLB geometry round-trip. Screenshots and machine-readable test output are included in `docs/verification/`.

The execution environment's installed Chromium policy blocks navigation, and its WebGPU/WebGL2 contexts were unavailable. Browser checks therefore ran the original application modules in an isolated `about:blank` DOM with only local subresources routed. They did not mock the engine. **Hardware WebGPU execution, WebGL2 execution, persistent-origin IndexedDB and HTTP-origin worker loading remain unverified here.** AO math and cancellation were exercised in Node. The separate GPU validation page exists to close the hardware-validation gap, not to imply that it has already passed.

## Static deployment

`npm run build` produces `dist/`, with relative paths suitable for a repository subpath. Serve that directory over HTTPS. `.github/workflows/pages.yml` is an opt-in manual GitHub Pages deployment; enable Pages with GitHub Actions before running it. The source archive itself has not been published or committed to any account by this delivery.

## License

MIT for this original implementation. PatinaStudio is independent and not affiliated with Adobe. The included geometry, procedural materials, icon paths, UI and code were created for this implementation. No remote fonts, telemetry or cloud processing are required.
