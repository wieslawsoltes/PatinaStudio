/** UV-space geometry rasterizer and deterministic cosine-hemisphere AO baker.
 * No global document state; works in Node, the window, or a module worker.
 */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => {
    const l = Math.hypot(...a) || 1;
    return a.map(x => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = x => Math.max(0, Math.min(1, x));
export function computeCurvature(mesh) {
    const { positions: p, normals: n, indices: ind } = mesh, count = p.length / 3, groups = new Map(), ids = new Uint32Array(count), weld = [];
    for (let i = 0; i < count; i++) {
        const key = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]].map(v => Math.round(v * 1e5)).join(',');
        let id = groups.get(key);
        if (id === undefined) {
            id = weld.length;
            groups.set(key, id);
            weld.push({ position: Array.from(p.subarray(i * 3, i * 3 + 3)), normal: [0, 0, 0], adj: new Set() });
        }
        ids[i] = id;
        for (let k = 0; k < 3; k++)
            weld[id].normal[k] += n[i * 3 + k];
    }
    for (let i = 0; i < ind.length; i += 3)
        for (let j = 0; j < 3; j++) {
            const a = ids[ind[i + j]], b = ids[ind[i + (j + 1) % 3]];
            if (a !== b) {
                weld[a].adj.add(b);
                weld[b].adj.add(a);
            }
        }
    const curv = new Float32Array(weld.length);
    for (let i = 0; i < weld.length; i++) {
        const v = weld[i], normal = norm(v.normal);
        let signed = 0, dist = 0;
        for (const j of v.adj) {
            const d = weld[j].position.map((x, k) => x - v.position[k]);
            signed -= dot(d, normal);
            dist += dot(d, d);
        }
        curv[i] = clamp(.5 + signed / Math.max(dist, 1e-8) * .14);
    }
    return Float32Array.from(ids, id => curv[id]);
}
export function rasterizeGeometry(mesh, resolution = 256) {
    if (!Number.isInteger(resolution) || resolution < 16 || resolution > 2048)
        throw Error('Invalid bake resolution.');
    const N = resolution, size = N * N, positions = new Float32Array(size * 3), normals = new Float32Array(size * 3), geometry = new Uint8ClampedArray(size * 4), surface = new Uint8ClampedArray(size * 4), triangles = new Int32Array(size).fill(-1), curvature = computeCurvature(mesh), { positions: p, normals: n, uvs: uv, indices: ind } = mesh;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
        minY = Math.min(minY, p[i]);
        maxY = Math.max(maxY, p[i]);
    }
    for (let i = 0; i < size; i++) {
        geometry.set([128, 128, 255, 128], i * 4);
        surface.set([255, 128, 0, 255], i * 4);
    }
    for (let t = 0; t < ind.length; t += 3) {
        const a = ind[t], b = ind[t + 1], c = ind[t + 2], ax = uv[a * 2] * N, ay = uv[a * 2 + 1] * N, bx = uv[b * 2] * N, by = uv[b * 2 + 1] * N, cx = uv[c * 2] * N, cy = uv[c * 2 + 1] * N, det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-10)
            continue;
        const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx))), miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = miny; y <= maxy; y++)
            for (let x = minx; x <= maxx; x++) {
                const u = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) / det, v = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) / det, w = 1 - u - v;
                if (u < -.00001 || v < -.00001 || w < -.00001)
                    continue;
                const i = y * N + x;
                triangles[i] = t / 3;
                const pos = [0, 0, 0], nn = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                    pos[k] = p[a * 3 + k] * u + p[b * 3 + k] * v + p[c * 3 + k] * w;
                    nn[k] = n[a * 3 + k] * u + n[b * 3 + k] * v + n[c * 3 + k] * w;
                }
                const no = norm(nn);
                positions.set(pos, i * 3);
                normals.set(no, i * 3);
                geometry.set([...no.map(v => (v * .5 + .5) * 255), (curvature[a] * u + curvature[b] * v + curvature[c] * w) * 255], i * 4);
                surface.set([255, clamp((pos[1] - minY) / (maxY - minY || 1)) * 255, 255, 255], i * 4);
            }
    }
    return { resolution, positions, normals, geometry, surface, triangles };
}
export function dilateMaps(maps, iterations = 4) {
    const N = maps.resolution;
    let coverage = Uint8Array.from(maps.triangles, t => +(t >= 0));
    for (let pass = 0; pass < iterations; pass++) {
        const next = coverage.slice(), g = maps.geometry.slice(), s = maps.surface.slice();
        for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++) {
                const i = y * N + x;
                if (coverage[i])
                    continue;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    const xx = x + dx, yy = y + dy, j = yy * N + xx;
                    if (xx < 0 || yy < 0 || xx >= N || yy >= N || !coverage[j])
                        continue;
                    g.set(maps.geometry.subarray(j * 4, j * 4 + 4), i * 4);
                    s.set(maps.surface.subarray(j * 4, j * 4 + 4), i * 4);
                    next[i] = 1;
                    break;
                }
            }
        maps.geometry = g;
        maps.surface = s;
        coverage = next;
    }
    return maps;
}
export async function bakeMaps(mesh, { resolution = 256, samples = 12, maxDistance = .5, BVH, onProgress = () => {
}, cancelled = () => false } = {}) {
    const maps = rasterizeGeometry(mesh, resolution);
    if (samples > 0) {
        if (!BVH)
            throw Error('AO baking requires a BVH constructor.');
        const bvh = new BVH(mesh), N = resolution;
        for (let y = 0; y < N; y++) {
            if (cancelled())
                throw new DOMException('Bake cancelled', 'AbortError');
            for (let x = 0; x < N; x++) {
                const i = y * N + x;
                if (maps.triangles[i] < 0)
                    continue;
                const p = Array.from(maps.positions.subarray(i * 3, i * 3 + 3)), n = Array.from(maps.normals.subarray(i * 3, i * 3 + 3)), t = norm(cross(Math.abs(n[1]) < .95 ? [0, 1, 0] : [1, 0, 0], n)), b = cross(n, t), origin = p.map((v, k) => v + n[k] * .002);
                let occluded = 0;
                for (let s = 0; s < samples; s++) {
                    const u = (s + .5) / samples, phi = (s * 2.39996323 + ((x * 13 + y * 7) % 31) / 31) * 1, r = Math.sqrt(u), vx = r * Math.cos(phi), vy = r * Math.sin(phi), vz = Math.sqrt(1 - u), d = n.map((v, k) => t[k] * vx + b[k] * vy + v * vz);
                    if (bvh.hit(origin, d, maxDistance, maps.triangles[i]))
                        occluded++;
                }
                maps.surface[i * 4] = (1 - occluded / samples) * 255;
            }
            if (y % 8 === 0) {
                onProgress(y / N);
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }
    onProgress(1);
    return dilateMaps(maps, 4);
}
/** Worker client passes dependency URLs explicitly; no import-map support is assumed in workers. */
export class BakeWorker {
    constructor() {
        this.worker = null;
    }
    run(mesh, options, onProgress) {
        this.cancel();
        return new Promise((resolve, reject) => {
            const worker = this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
            this.reject = reject;
            worker.onmessage = ({ data }) => {
                if (data.type === 'progress') {
                    onProgress?.(data.value);
                    return;
                }
                worker.terminate();
                this.worker = null;
                this.reject = null;
                if (data.type === 'error')
                    reject(Error(data.message));
                else
                    resolve(data.maps);
            };
            worker.onerror = e => {
                worker.terminate();
                this.worker = null;
                this.reject = null;
                reject(Error(e.message));
            };
            worker.postMessage({ mesh, options, mathURL: options.mathURL });
        });
    }
    cancel() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.reject?.(new DOMException('Bake cancelled', 'AbortError'));
            this.reject = null;
        }
    }
}
