/** Column-major matrices, right-handed world, WebGPU [0, 1] clip depth. */
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => scale(a, 1 / (length(a) || 1));
export function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
export function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++)
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
export function perspective(fov, aspect, near = .01, far = 100) {
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0]);
}
export function lookAt(eye, target, up = [0, 1, 0]) {
    const z = normalize(sub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
export function invert(a) {
    const out = new Float32Array(16), m = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? a[c * 4 + r] : +(c - 4 === r)));
    for (let i = 0; i < 4; i++) {
        let p = i;
        for (let j = i + 1; j < 4; j++)
            if (Math.abs(m[j][i]) > Math.abs(m[p][i]))
                p = j;
        if (Math.abs(m[p][i]) < 1e-12)
            throw Error('Singular matrix');
        [m[i], m[p]] = [m[p], m[i]];
        const s = m[i][i];
        for (let c = 0; c < 8; c++)
            m[i][c] /= s;
        for (let r = 0; r < 4; r++)
            if (r !== i) {
                const k = m[r][i];
                for (let c = 0; c < 8; c++)
                    m[r][c] -= k * m[i][c];
            }
    }
    for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
            out[c * 4 + r] = m[r][c + 4];
    return out;
}
export function transform(m, v, w = 1) {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++)
        o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w;
    return w && o[3] ? o.slice(0, 3).map(x => x / o[3]) : o.slice(0, 3);
}
export function rayTriangle(o, d, a, b, c, max = Infinity) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-9)
        return null;
    const inv = 1 / det, tv = sub(o, a), u = dot(tv, p) * inv;
    if (u < 0 || u > 1)
        return null;
    const q = cross(tv, e1), v = dot(d, q) * inv;
    if (v < 0 || u + v > 1)
        return null;
    const t = dot(e2, q) * inv;
    return t > 1e-6 && t < max ? { t, u, v } : null;
}
export class OrbitCamera {
    constructor() {
        this.yaw = .42;
        this.pitch = .17;
        this.distance = 4.5;
        this.target = [0, -.13, 0];
        this.fov = Math.PI / 4;
    }
    get eye() {
        const r = this.distance, c = Math.cos(this.pitch);
        return add(this.target, [Math.sin(this.yaw) * c * r, Math.sin(this.pitch) * r, Math.cos(this.yaw) * c * r]);
    }
    matrix(aspect) {
        return multiply(perspective(this.fov, aspect), lookAt(this.eye, this.target));
    }
    ray(nx, ny, aspect) {
        const inv = invert(this.matrix(aspect)), p = transform(inv, [nx, ny, 0]), q = transform(inv, [nx, ny, 1]);
        return { origin: p, direction: normalize(sub(q, p)) };
    }
    orbit(dx, dy) {
        this.yaw -= dx * .007;
        this.pitch = clamp(this.pitch + dy * .007, -1.48, 1.48);
    }
    zoom(delta) {
        this.distance = clamp(this.distance * Math.exp(delta * .001), 1.4, 20);
    }
    pan(dx, dy) {
        const z = normalize(sub(this.eye, this.target)), right = normalize(cross([0, 1, 0], z)), up = cross(z, right);
        this.target = add(this.target, add(scale(right, -dx * this.distance * .001), scale(up, dy * this.distance * .001)));
    }
    reset() {
        Object.assign(this, new OrbitCamera());
    }
}
/** Median-split BVH. Triangles retain original indices for UV interpolation. */
export class BVH {
    constructor(mesh) {
        this.mesh = mesh;
        const ids = Array.from({ length: mesh.indices.length / 3 }, (_, i) => i);
        this.root = this.build(ids);
    }
    vertex(i) {
        return this.mesh.positions.subarray(i * 3, i * 3 + 3);
    }
    build(ids) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const t of ids)
            for (let j = 0; j < 3; j++) {
                const p = this.vertex(this.mesh.indices[t * 3 + j]);
                for (let k = 0; k < 3; k++) {
                    min[k] = Math.min(min[k], p[k]);
                    max[k] = Math.max(max[k], p[k]);
                }
            }
        if (ids.length <= 8)
            return { min, max, ids };
        const ext = sub(max, min), axis = ext.indexOf(Math.max(...ext));
        const mid = t => (this.vertex(this.mesh.indices[t * 3])[axis] + this.vertex(this.mesh.indices[t * 3 + 1])[axis] + this.vertex(this.mesh.indices[t * 3 + 2])[axis]) / 3;
        ids.sort((a, b) => mid(a) - mid(b));
        const h = ids.length >> 1;
        return { min, max, left: this.build(ids.slice(0, h)), right: this.build(ids.slice(h)) };
    }
    hit(origin, direction, maxDistance = Infinity, ignore = -1) {
        let best = null, limit = maxDistance;
        const box = n => {
            let lo = 0, hi = limit;
            for (let k = 0; k < 3; k++) {
                if (Math.abs(direction[k]) < 1e-12) {
                    if (origin[k] < n.min[k] || origin[k] > n.max[k])
                        return false;
                }
                else {
                    let a = (n.min[k] - origin[k]) / direction[k], b = (n.max[k] - origin[k]) / direction[k];
                    if (a > b)
                        [a, b] = [b, a];
                    lo = Math.max(lo, a);
                    hi = Math.min(hi, b);
                    if (lo > hi)
                        return false;
                }
            }
            return true;
        };
        const visit = n => {
            if (!box(n))
                return;
            if (n.ids) {
                for (const t of n.ids) {
                    if (t === ignore)
                        continue;
                    const i = this.mesh.indices.subarray(t * 3, t * 3 + 3), h = rayTriangle(origin, direction, this.vertex(i[0]), this.vertex(i[1]), this.vertex(i[2]), limit);
                    if (h) {
                        limit = h.t;
                        best = { ...h, triangle: t, indices: Array.from(i) };
                    }
                }
            }
            else {
                visit(n.left);
                visit(n.right);
            }
        };
        visit(this.root);
        if (best) {
            const w = [1 - best.u - best.v, best.u, best.v];
            best.uv = [0, 0];
            best.normal = [0, 0, 0];
            for (let j = 0; j < 3; j++) {
                const i = best.indices[j];
                for (let k = 0; k < 2; k++)
                    best.uv[k] += this.mesh.uvs[i * 2 + k] * w[j];
                for (let k = 0; k < 3; k++)
                    best.normal[k] += this.mesh.normals[i * 3 + k] * w[j];
            }
            best.normal = normalize(best.normal);
            best.position = add(origin, scale(direction, best.t));
        }
        return best;
    }
}
