# Verification report

Date: 2026-09-15. This report separates implementation from evidence. No hardware WebGPU validation is claimed.

## Executed and passed

| Check | Result | Evidence |
|---|---|---|
| JavaScript syntax | All app/package/example/script files passed `node --check` | `verification/syntax-check.txt` |
| Core tests | **35/35 passed** | `verification/node-tests.txt` |
| Chromium UI/software integration | **19/19 checks passed**, zero page errors | `verification/browser-report.json` |
| Standalone package installation | Ten local tarballs installed offline into a separate npm project | `verification/standalone-packages.txt` |
| Standalone imports | All ten packages imported without the Studio or source workspace | Same file |
| Independent library integration | Project/material/CPU-paint packages produced pixels outside the source workspace | Same file |
| Node-only example | Generated a PPM material image and editable project | `examples/library-usage.mjs` |
| Example project | Artifact-07.patina passed project validation | `examples/Artifact-07.patina` |
| Static build | `npm run build` produced a local, relative-path distribution | `dist/` in release archive |

The core tests cover matrices, camera rays, ray/triangle intersections, mesh primitives and winding, BVH picking, OBJ import/round-trip, mesh serialization, history branches/bounds, schema rejection, bounded procedural channels, pressure spacing/seam resets, geometry rasterization, welded curvature, ray-based AO and cancellation, paint/erase/mask pixels, composition, normal generation, channel packing, CRC32/ZIP structures and untrusted-input validation.

The browser checks operate the actual editor controls and canvases. They verify UV and 3D painting with recorded semantic stamps, real changed texture bytes, undo/redo reconstruction, painted mask bytes, text decals, painting retained across image-decal replay, seven exported PNGs and manifest convention, GLB embedded geometry/textures, exported GLB geometry reimport, portable project contents, command palette, channel switching and a non-overflowing 1100×760 layout.

## Environment restriction and exact workaround

The installed Chromium runtime is version 144.0.7559.96. Its managed browser policy blocks navigation, including localhost. That policy was not changed. WebGPU and WebGL2 contexts were also unavailable in this runtime. Downloading a separate browser runtime failed because the shell's external DNS/network access was unavailable.

`tests/browser_dom.py` therefore opens `about:blank`, injects the original application's HTML and import map, and routes only this checked-out application's local JS/CSS subresources. It runs the actual `Studio`, `CPUPaintEngine`, `SoftwareRenderer`, project, I/O and UI packages. It does not replace painting, pixels, geometry, export or UI handlers with test doubles.

IndexedDB access is denied in that opaque origin. The app visibly reports “Local save unavailable” and still supports portable file export. Browser console warnings about storage and missing adapters are expected in this test environment; they are not counted as successful persistence or GPU execution.

## Not verified here

**WebGPU shader compilation and hardware execution**, **WebGL2 execution**, **IndexedDB persistence on a normal origin**, and **module-worker loading from an HTTP/HTTPS origin** were not exercised by the restricted browser test. The AO kernel itself ran in Node, including cancellation. Pen pressure hardware, GPU device-loss behavior, high-DPI behavior across platforms, large-model throughput and assistive-technology navigation still need representative device testing.

No production frame-rate, GPU throughput, commercial interchange fidelity or feature-parity claim follows from these tests. The software screenshot is not labeled as a WebGPU render. Render “submit” time in the WebGPU UI is CPU submission duration, not GPU completion time.

## Reproduce core and UI checks

```sh
npm ci --ignore-scripts
npm run check
npm test
node examples/library-usage.mjs
npm run pack:libs
npm run build
```

The restricted DOM test uses Python Playwright and an installed Chromium executable:

```sh
pip install playwright
CHROMIUM_PATH=/path/to/chromium PATINA_ARTIFACTS=./test-artifacts \
  python tests/browser_dom.py
```

`tests/browser_smoke.py` performs a normal localhost navigation. Start `npm start` first. In the current environment it fails before the application loads because of managed navigation policy; that failure is not a completed app smoke test.

To verify the GPU without any test framework, serve the app and open `examples/gpu-validation.html` on localhost or HTTPS. It requests a real adapter, compiles all compute/render pipelines, compares simple CPU/GPU blending and masking, renders PBR/wire/UV views, executes a worker bake and offers a JSON report. It does not convert a missing adapter into a passing result. This harness is included but was not run successfully on a GPU here.

## Screenshots

`verification/workspace-software.png` is the original demo at 1600×1000. `verification/compact-workspace.png` is the edited test session at 1100×760. Both are real browser screenshots of the software fallback; neither is an image-generated mockup.
