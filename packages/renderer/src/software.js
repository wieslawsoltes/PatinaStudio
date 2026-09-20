const clamp = x => Math.min(1, Math.max(0, x));
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** 2.2);
const normalize3 = (x, y, z) => {
    const r = 1 / (Math.hypot(x, y, z) || 1);
    return [x * r, y * r, z * r];
};
const LIGHT = normalize3(-.6, .8, .8), FILL = normalize3(.8, .3, .35);
/** CPU fallback, not WebGPU emulation. Perspective-correct indexed triangles,
 * depth testing and tangent-space normal mapping, with a bounded pixel budget.
 * No arrays are allocated in the fragment loop. Device-independent proof of
 * editing remains available even when the browser has no graphics adapter.
 */
export class SoftwareRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx)
            throw Error('Canvas rendering is unavailable.');
        this.exposure = 1.1;
        this.channel = 0;
        this.environment = 0;
        this.rotation = 0;
        this.frames = 0;
        this.wireframe = false;
        this.software = true;
        this.maxDimension = 640;
        this.surface = new OffscreenCanvas(1, 1);
        this.tone = new Uint8ClampedArray(8192);
    }
    async init() {
        return this;
    }
    setMesh(mesh) {
        this.mesh = mesh;
        this.vertices = new Float32Array(mesh.positions.length / 3 * 4);
        const { positions: p, uvs: u, indices: i } = mesh;
        this.bases = new Float32Array(i.length * 2);
        for (let t = 0; t < i.length; t += 3) {
            const a = i[t], b = i[t + 1], c = i[t + 2];
            const e1x = p[b * 3] - p[a * 3], e1y = p[b * 3 + 1] - p[a * 3 + 1], e1z = p[b * 3 + 2] - p[a * 3 + 2];
            const e2x = p[c * 3] - p[a * 3], e2y = p[c * 3 + 1] - p[a * 3 + 1], e2z = p[c * 3 + 2] - p[a * 3 + 2];
            const du1 = u[b * 2] - u[a * 2], dv1 = u[b * 2 + 1] - u[a * 2 + 1], du2 = u[c * 2] - u[a * 2], dv2 = u[c * 2 + 1] - u[a * 2 + 1];
            const sign = du1 * dv2 - du2 * dv1 < 0 ? -1 : 1;
            this.bases.set(normalize3((e1x * dv2 - e2x * dv1) * sign, (e1y * dv2 - e2y * dv1) * sign, (e1z * dv2 - e2z * dv1) * sign), t * 2);
            this.bases.set(normalize3((e2x * du1 - e1x * du2) * sign, (e2y * du1 - e1y * du2) * sign, (e2z * du1 - e1z * du2) * sign), t * 2 + 3);
        }
    }
    setMaps(maps) {
        this.maps = maps;
    }
    render(camera) {
        if (!this.maps || !this.mesh)
            return;
        const rect = this.canvas.getBoundingClientRect(), factor = Math.min(1, this.maxDimension / Math.max(rect.width, rect.height));
        const W = Math.max(1, Math.round(rect.width * factor)), H = Math.max(1, Math.round(rect.height * factor));
        if (this.canvas.width !== W || this.canvas.height !== H || !this.image) {
            this.canvas.width = W;
            this.canvas.height = H;
            this.image = this.ctx.createImageData(W, H);
            this.depth = new Float32Array(W * H);
        }
        if (this.lastExposure !== this.exposure) {
            this.lastExposure = this.exposure;
            for (let i = 0; i < this.tone.length; i++) {
                const x = i / 1024 * this.exposure;
                this.tone[i] = 255 * clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14)) ** (1 / 2.2);
            }
        }
        const pixels = this.image.data, depth = this.depth, verts = this.vertices, bases = this.bases;
        const { positions: p, normals: n, uvs: uv, indices } = this.mesh;
        const N = this.maps.resolution, tex = this.maps.color, aux = this.maps.aux, nm = this.maps.normal;
        const [ex, ey, ez] = camera.eye, m = camera.matrix(W / H), mode = this.channel, tone = this.tone;
        depth.fill(Infinity);
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const k = (y * W + x) * 4, v = Math.max(0, 1 - Math.hypot((x - W / 2) / W, (y - H / 2) / H));
                const sx = (x - W * .5) / (W * .3), sy = (y - H * .81) / (H * .055), shadow = Math.exp(-sx * sx - sy * sy) * .35;
                pixels[k] = (22 + v * 23) * (1 - shadow);
                pixels[k + 1] = (28 + v * 25) * (1 - shadow);
                pixels[k + 2] = (27 + v * 23) * (1 - shadow);
                pixels[k + 3] = 255;
            }
        for (let i = 0, j = 0; i < p.length; i += 3, j += 4) {
            const x = p[i], y = p[i + 1], z = p[i + 2], iw = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
            verts[j] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) * iw * .5 + .5) * W;
            verts[j + 1] = (.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw * .5) * H;
            verts[j + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
            verts[j + 3] = iw;
        }
        const [lx, ly, lz] = LIGHT, [fx, fy, fz] = FILL;
        for (let t = 0; t < indices.length; t += 3) {
            const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2], a = ia * 4, b = ib * 4, c = ic * 4;
            if (verts[a + 3] <= 0 || verts[b + 3] <= 0 || verts[c + 3] <= 0)
                continue;
            const ax = verts[a], ay = verts[a + 1], bx = verts[b], by = verts[b + 1], cx = verts[c], cy = verts[c + 1];
            const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.abs(det) < 1e-7)
                continue;
            const A = ia * 3, B = ib * 3, C = ic * 3;
            if (n[A] * (ex - p[A]) + n[A + 1] * (ey - p[A + 1]) + n[A + 2] * (ez - p[A + 2]) < -.12)
                continue;
            const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
            const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
            const rdet = 1 / det, tx = bases[t * 2], ty = bases[t * 2 + 1], tz = bases[t * 2 + 2], bxn = bases[t * 2 + 3], byn = bases[t * 2 + 4], bzn = bases[t * 2 + 5];
            for (let y = miny; y <= maxy; y++)
                for (let x = minx; x <= maxx; x++) {
                    const wa = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) * rdet;
                    const wb = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) * rdet, wc = 1 - wa - wb;
                    if (wa < 0 || wb < 0 || wc < 0)
                        continue;
                    const z = wa * verts[a + 2] + wb * verts[b + 2] + wc * verts[c + 2], idx = y * W + x;
                    if (z < 0 || z > 1 || z >= depth[idx])
                        continue;
                    depth[idx] = z;
                    const iw = 1 / (wa * verts[a + 3] + wb * verts[b + 3] + wc * verts[c + 3]);
                    const u0 = wa * verts[a + 3] * iw, u1 = wb * verts[b + 3] * iw, u2 = wc * verts[c + 3] * iw;
                    const u = uv[ia * 2] * u0 + uv[ib * 2] * u1 + uv[ic * 2] * u2, v = uv[ia * 2 + 1] * u0 + uv[ib * 2 + 1] * u1 + uv[ic * 2 + 1] * u2;
                    const ix = Math.max(0, Math.min(N - 1, Math.floor(u * N))), iy = Math.max(0, Math.min(N - 1, Math.floor(v * N))), ti = (iy * N + ix) * 4, k = idx * 4;
                    if (mode === 1) {
                        pixels[k] = tex[ti];
                        pixels[k + 1] = tex[ti + 1];
                        pixels[k + 2] = tex[ti + 2];
                        continue;
                    }
                    if (mode === 2 || mode === 3 || mode === 5 || mode === 6 || mode === 7) {
                        const value = mode === 2 ? aux[ti + 1] : mode === 3 ? aux[ti] : mode === 5 ? aux[ti + 2] : mode === 6 ? aux[ti + 3] : ((Math.floor(u * 16) + Math.floor(v * 16)) % 2) * 127 + 51;
                        pixels[k] = pixels[k + 1] = pixels[k + 2] = value;
                        continue;
                    }
                    let nx = n[A] * u0 + n[B] * u1 + n[C] * u2, ny = n[A + 1] * u0 + n[B + 1] * u1 + n[C + 1] * u2, nz = n[A + 2] * u0 + n[B + 2] * u1 + n[C + 2] * u2;
                    let q = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
                    nx *= q;
                    ny *= q;
                    nz *= q;
                    const mx = nm[ti] / 127.5 - 1, my = nm[ti + 1] / 127.5 - 1, mz = nm[ti + 2] / 127.5 - 1;
                    nx = nx * mz + (tx * mx - bxn * my) * .45;
                    ny = ny * mz + (ty * mx - byn * my) * .45;
                    nz = nz * mz + (tz * mx - bzn * my) * .45;
                    q = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
                    nx *= q;
                    ny *= q;
                    nz *= q;
                    if (mode === 4) {
                        pixels[k] = nx * 127.5 + 127.5;
                        pixels[k + 1] = ny * 127.5 + 127.5;
                        pixels[k + 2] = nz * 127.5 + 127.5;
                        continue;
                    }
                    let vx = ex - (p[A] * u0 + p[B] * u1 + p[C] * u2), vy = ey - (p[A + 1] * u0 + p[B + 1] * u1 + p[C + 1] * u2), vz = ez - (p[A + 2] * u0 + p[B + 2] * u1 + p[C + 2] * u2);
                    q = 1 / (Math.sqrt(vx * vx + vy * vy + vz * vz) || 1);
                    vx *= q;
                    vy *= q;
                    vz *= q;
                    const hx = lx + vx, hy = ly + vy, hz = lz + vz, hi = 1 / (Math.sqrt(hx * hx + hy * hy + hz * hz) || 1);
                    const rough = aux[ti + 1] / 255, metal = aux[ti] / 255, ao = aux[ti + 3] / 255;
                    const diffuse = (.27 + Math.max(0, nx * lx + ny * ly + nz * lz) * .8 + Math.max(0, nx * fx + ny * fy + nz * fz) * .23) * (1 - metal * .25);
                    const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) * hi), Math.max(3, (1 - rough) * 100)) * (1 - rough) * 1.6;
                    const reflect = spec + .1 + Math.pow(1 - Math.max(0, nx * vx + ny * vy + nz * vz), 5) * .2;
                    for (let d = 0; d < 3; d++) {
                        const base = LINEAR[tex[ti + d]], lightColor = d === 0 ? 1.2 : d === 1 ? 1.12 : .92;
                        const value = (base * diffuse + reflect * (.06 + metal * base) * lightColor) * ao;
                        pixels[k + d] = tone[Math.min(8191, Math.max(0, Math.round(value * 1024)))];
                    }
                }
        }
        this.ctx.putImageData(this.image, 0, 0);
        this.frames++;
    }
    renderUV(canvas) {
        if (!this.maps)
            return;
        const N = this.maps.resolution, raw = this.channel === 4 ? this.maps.normal : this.maps.color;
        let data = raw;
        if ([2, 3, 5, 6].includes(this.channel)) {
            const channel = ({ 2: 1, 3: 0, 5: 2, 6: 3 })[this.channel];
            data = new Uint8ClampedArray(N * N * 4);
            for (let i = 0; i < data.length; i += 4)
                data.set([this.maps.aux[i + channel], this.maps.aux[i + channel], this.maps.aux[i + channel], 255], i);
        }
        else if (this.channel === 7) {
            data = new Uint8ClampedArray(N * N * 4);
            for (let y = 0; y < N; y++)
                for (let x = 0; x < N; x++) {
                    const c = ((Math.floor(x / N * 16) + Math.floor(y / N * 16)) % 2) * 127 + 51;
                    data.set([c, c, c, 255], (y * N + x) * 4);
                }
        }
        this.surface.width = this.surface.height = N;
        this.surface.getContext('2d').putImageData(new ImageData(data, N, N), 0, 0);
        const r = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(r.width));
        canvas.height = Math.max(1, Math.floor(r.height));
        canvas.getContext('2d').drawImage(this.surface, 0, 0, canvas.width, canvas.height);
    }
    dispose() {
        this.mesh = this.maps = this.image = this.depth = this.bases = this.vertices = null;
    }
}
