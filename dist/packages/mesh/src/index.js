import { normalize, sub, cross } from '@patina/math';
export function validateMesh(mesh) {
    const { positions: p, normals: n, uvs: u, indices: i } = mesh;
    if (!p?.length || p.length % 3 || !i?.length || i.length % 3)
        throw Error('A triangle mesh with positions is required.');
    if (p.length > 3000000 || i.length > 6000000)
        throw Error('Mesh exceeds the 1M vertex / 2M triangle safety limit.');
    if (u?.length !== p.length / 3 * 2)
        throw Error('The mesh must have a complete UV set.');
    if (n?.length !== p.length)
        throw Error('The mesh must have complete normals.');
    for (const v of p)
        if (!Number.isFinite(v))
            throw Error('Non-finite vertex.');
    for (const v of n)
        if (!Number.isFinite(v))
            throw Error('Non-finite normal.');
    for (const v of u)
        if (!Number.isFinite(v))
            throw Error('Non-finite UV.');
    for (const v of i)
        if (!Number.isInteger(v) || v < 0 || v >= p.length / 3)
            throw Error('Invalid triangle index.');
    return mesh;
}
export function calculateNormals(positions, indices) {
    const n = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
        const x = cross(sub(positions.subarray(b, b + 3), positions.subarray(a, a + 3)), sub(positions.subarray(c, c + 3), positions.subarray(a, a + 3)));
        for (const i of [a, b, c])
            for (let k = 0; k < 3; k++)
                n[i + k] += x[k];
    }
    for (let i = 0; i < n.length; i += 3)
        n.set(normalize(n.subarray(i, i + 3)), i);
    return n;
}
export function fitMesh(mesh) {
    const p = mesh.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[i + k]);
            max[k] = Math.max(max[k], p[i + k]);
        }
    const s = 2 / Math.max(...max.map((x, k) => x - min[k]), 1e-5), c = min.map((x, k) => (x + max[k]) / 2);
    for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++)
            p[i + k] = (p[i + k] - c[k]) * s;
    return mesh;
}
class Builder {
    constructor() {
        this.p = [];
        this.n = [];
        this.u = [];
        this.i = [];
    }
    lathe(profile, segments = 128, rect = [0, 0, 1, 1], tilt = 0) {
        const base = this.p.length / 3, ct = Math.cos(tilt), st = Math.sin(tilt);
        for (let j = 0; j < profile.length; j++) {
            const [r, y] = profile[j], prev = profile[Math.max(0, j - 1)], next = profile[Math.min(profile.length - 1, j + 1)];
            const dr = next[0] - prev[0], dy = next[1] - prev[1];
            for (let k = 0; k <= segments; k++) {
                const a = k / segments * Math.PI * 2, x = r * Math.cos(a), z = r * Math.sin(a), nn = normalize([-dy * Math.cos(a), dr, -dy * Math.sin(a)]);
                this.p.push(x * ct - y * st, x * st + y * ct, z);
                this.n.push(nn[0] * ct - nn[1] * st, nn[0] * st + nn[1] * ct, nn[2]);
                this.u.push(rect[0] + (1 - k / segments) * rect[2], rect[1] + j / (profile.length - 1) * rect[3]);
            }
        }
        for (let j = 0; j < profile.length - 1; j++)
            for (let k = 0; k < segments; k++) {
                const a = base + j * (segments + 1) + k, b = a + segments + 1;
                this.i.push(a, a + 1, b, a + 1, b + 1, b);
            }
    }
    result(name) {
        return { name, positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.u), indices: new Uint32Array(this.i) };
    }
}
export function createArtifact() {
    const b = new Builder(), profile = [];
    for (let j = 0; j <= 144; j++) {
        const t = .001 + (Math.PI - .002) * j / 144;
        let r = Math.sin(t), y = Math.cos(t);
        for (const [at, width, depth] of [[.64, .033, .048], [.76, .015, .022], [1.5, .031, .045], [1.61, .014, .018], [2.45, .04, .042]]) {
            const d = Math.abs(t - at);
            r -= depth * Math.exp(-Math.pow(d / width, 6));
        }
        profile.push([Math.max(.001, r), y + .08]);
    }
    b.lathe(profile, 160, [.015, .015, .97, .735], -.24);
    b.lathe([[.001, -.975], [.27, -.975], [.28, -.99], [.28, -1.07], [.43, -1.1], [.45, -1.115], [.45, -1.15], [.6, -1.15], [.62, -1.17], [.62, -1.22], [.6, -1.24], [.6, -1.28], [.62, -1.29], [.62, -1.34], [.6, -1.36], [.001, -1.36]], 128, [.015, .77, .97, .215]);
    return b.result('Artifact 07');
}
export function createSphere() {
    const b = new Builder(), p = [];
    for (let j = 0; j <= 96; j++) {
        const t = .0001 + (Math.PI - .0002) * j / 96;
        p.push([Math.sin(t), Math.cos(t)]);
    }
    b.lathe(p, 128, [.01, .01, .98, .98]);
    return b.result('Material sphere');
}
export function createTorus() {
    const b = new Builder(), N = 128, M = 48;
    for (let i = 0; i <= M; i++) {
        const v = i / M * Math.PI * 2;
        for (let j = 0; j <= N; j++) {
            const u = j / N * Math.PI * 2, r = .72 + .3 * Math.cos(v);
            b.p.push(r * Math.cos(u), .3 * Math.sin(v), r * Math.sin(u));
            b.n.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
            b.u.push(j / N, i / M);
        }
    }
    for (let i = 0; i < M; i++)
        for (let j = 0; j < N; j++) {
            const a = i * (N + 1) + j, c = a + N + 1;
            b.i.push(a, c, a + 1, a + 1, c, c + 1);
        }
    return b.result('Torus');
}
export function createCube() {
    const p = [], n = [], u = [], idx = [];
    const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    for (let f = 0; f < 6; f++) {
        const [normal, x, y] = faces[f], base = p.length / 3;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            for (let k = 0; k < 3; k++)
                p.push(normal[k] * .8 + x[k] * a * .8 + y[k] * b * .8);
            n.push(...normal);
            u.push((f % 3 + .05 + (a + 1) / 2 * .9) / 3, (Math.floor(f / 3) + .05 + (1 - b) / 2 * .9) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { name: 'UV cube', positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(u), indices: new Uint32Array(idx) };
}
export const primitives = { artifact: createArtifact, sphere: createSphere, torus: createTorus, cube: createCube };
/** Wavefront OBJ: triangulation, negative indices, per-corner normals and UVs. */
export function parseOBJ(text) {
    const vp = [], vn = [], vt = [], p = [], n = [], u = [], idx = [], cache = new Map();
    let missingNormals = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line[0] === '#')
            continue;
        const [tag, ...v] = line.split(/\s+/);
        if (tag === 'v')
            vp.push(v.slice(0, 3).map(Number));
        else if (tag === 'vn')
            vn.push(v.slice(0, 3).map(Number));
        else if (tag === 'vt')
            vt.push([Number(v[0]), 1 - Number(v[1])]);
        else if (tag === 'f') {
            const face = v.map(token => {
                if (cache.has(token))
                    return cache.get(token);
                const a = token.split('/').map(Number), resolve = (i, x) => i > 0 ? x[i - 1] : i < 0 ? x[x.length + i] : null;
                const pos = resolve(a[0], vp), uv = resolve(a[1], vt), normal = resolve(a[2], vn);
                if (!pos)
                    throw Error('OBJ contains an invalid position index.');
                if (!uv)
                    throw Error('OBJ has no complete UV coordinates. Unwrap the model before importing.');
                if (!normal)
                    missingNormals = true;
                const id = p.length / 3;
                p.push(...pos);
                u.push(...uv);
                n.push(...(normal || [0, 0, 0]));
                cache.set(token, id);
                return id;
            });
            for (let j = 1; j < face.length - 1; j++)
                idx.push(face[0], face[j], face[j + 1]);
        }
    }
    const mesh = { name: 'Imported OBJ', positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(u), indices: new Uint32Array(idx) };
    if (missingNormals)
        mesh.normals = calculateNormals(mesh.positions, mesh.indices);
    return fitMesh(validateMesh(mesh));
}
export function exportOBJ(mesh) {
    const out = ['# PatinaStudio mesh export'];
    for (let i = 0; i < mesh.positions.length; i += 3)
        out.push('v ' + Array.from(mesh.positions.subarray(i, i + 3)).join(' '));
    for (let i = 0; i < mesh.uvs.length; i += 2)
        out.push(`vt ${mesh.uvs[i]} ${1 - mesh.uvs[i + 1]}`);
    for (let i = 0; i < mesh.normals.length; i += 3)
        out.push('vn ' + Array.from(mesh.normals.subarray(i, i + 3)).join(' '));
    for (let i = 0; i < mesh.indices.length; i += 3)
        out.push('f ' + Array.from(mesh.indices.subarray(i, i + 3), v => `${v + 1}/${v + 1}/${v + 1}`).join(' '));
    return out.join('\n');
}
export function serializeMesh(mesh) {
    return { name: mesh.name, positions: Array.from(mesh.positions), normals: Array.from(mesh.normals), uvs: Array.from(mesh.uvs), indices: Array.from(mesh.indices) };
}
export function deserializeMesh(m) {
    return validateMesh({ name: String(m.name || 'Mesh'), positions: new Float32Array(m.positions), normals: new Float32Array(m.normals), uvs: new Float32Array(m.uvs), indices: new Uint32Array(m.indices) });
}
