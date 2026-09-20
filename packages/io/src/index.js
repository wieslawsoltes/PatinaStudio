import { validateMesh, fitMesh, calculateNormals } from '@patina/mesh';
import { identity, multiply, transform, invert, normalize } from '@patina/math';
const enc = new TextEncoder(), align4 = x => (x + 3) & ~3;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++)
        n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
export function crc32(data) {
    let crc = 0xffffffff;
    for (const b of data)
        crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
/** Standards-compliant UTF-8 ZIP writer using uncompressed entries. */
export function zipFiles(files) {
    const chunks = [], directory = [];
    let offset = 0;
    for (const [name, value] of Object.entries(files)) {
        const path = enc.encode(name), data = typeof value === 'string' ? enc.encode(value) : new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength), crc = crc32(data), local = new Uint8Array(30 + path.length), v = new DataView(local.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x0800, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, data.length, true);
        v.setUint32(22, data.length, true);
        v.setUint16(26, path.length, true);
        local.set(path, 30);
        chunks.push(local, data);
        const central = new Uint8Array(46 + path.length), c = new DataView(central.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, data.length, true);
        c.setUint32(24, data.length, true);
        c.setUint16(28, path.length, true);
        c.setUint32(42, offset, true);
        central.set(path, 46);
        directory.push(central);
        offset += local.length + data.length;
    }
    const dirSize = directory.reduce((s, a) => s + a.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, directory.length, true);
    v.setUint16(10, directory.length, true);
    v.setUint32(12, dirSize, true);
    v.setUint32(16, offset, true);
    const result = new Uint8Array(offset + dirSize + 22);
    let at = 0;
    for (const a of [...chunks, ...directory, end]) {
        result.set(a, at);
        at += a.length;
    }
    return result;
}
export async function encodePNG(data, width, height = width) {
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
export function channelPixels(data, channel) {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4)
        out.set([data[i + channel], data[i + channel], data[i + channel], 255], i);
    return out;
}
export function packORM(aux) {
    const out = new Uint8ClampedArray(aux.length);
    for (let i = 0; i < aux.length; i += 4)
        out.set([aux[i + 3], aux[i + 1], aux[i], 255], i);
    return out;
}
export function flipNormalY(normal) {
    const out = normal.slice();
    for (let i = 1; i < out.length; i += 4)
        out[i] = 255 - out[i];
    return out;
}
export async function exportTextureBundle(maps, name = 'Material', normalConvention = 'OpenGL') {
    const n = maps.resolution, base = name.replace(/[^a-zA-Z0-9_-]/g, '_'), normal = normalConvention === 'DirectX' ? flipNormalY(maps.normal) : maps.normal, files = {};
    for (const [suffix, data] of Object.entries({ BaseColor: maps.color, Metallic: channelPixels(maps.aux, 0), Roughness: channelPixels(maps.aux, 1), Height: channelPixels(maps.aux, 2), AO: channelPixels(maps.aux, 3), Normal: normal, ORM: packORM(maps.aux) }))
        files[`${base}_${suffix}.png`] = await encodePNG(data, n);
    files['manifest.json'] = JSON.stringify({ generator: 'PatinaStudio', version: 1, resolution: n, normalConvention, baseColorSpace: 'sRGB', dataMapSpace: 'linear', packing: { ORM: { R: 'ambient occlusion', G: 'roughness', B: 'metallic' } }, heightMidpoint: .5 }, null, 2);
    files['README.txt'] = 'PatinaStudio texture export\nBaseColor is sRGB. All other maps contain linear data.\nORM: R = ambient occlusion, G = roughness, B = metallic.\nNormal convention: ' + normalConvention + '.\nHeight midpoint is 0.5. Normal map is derived from layer height.\n';
    return zipFiles(files);
}
export function download(data, name, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function nodeMatrix(node) {
    if (node.matrix)
        return new Float32Array(node.matrix);
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1], [tx, ty, tz] = node.translation || [0, 0, 0];
    return new Float32Array([(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1]);
}
/** Embedded GLB geometry import, transformed scene nodes, normalized accessors.
 * Rejects compressed/sparse/animated/skinned input instead of silently corrupting it.
 */
export function parseGLB(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
        throw Error('Expected a glTF 2.0 binary (.glb).');
    if (view.getUint32(8, true) !== buffer.byteLength)
        throw Error('GLB length mismatch.');
    let json, bin;
    for (let offset = 12; offset + 8 <= buffer.byteLength;) {
        const len = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
        offset += 8;
        if (offset + len > buffer.byteLength)
            throw Error('Invalid GLB chunk.');
        if (type === 0x4e4f534a)
            json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, len)).trim());
        if (type === 0x004e4942)
            bin = buffer.slice(offset, offset + len);
        offset += len;
    }
    if (!json || !bin)
        throw Error('GLB has no embedded geometry.');
    if (json.skins?.length || json.animations?.length)
        throw Error('Import a static, baked-pose GLB. Skinning and animation are not supported.');
    if (json.extensionsRequired?.some(x => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'].includes(x)))
        throw Error('Compressed GLB requires decompression before import.');
    const types = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, info = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 4294967295], 5126: [4, 'getFloat32', 1] }, dv = new DataView(bin);
    const read = id => {
        const a = json.accessors[id];
        if (!a || a.sparse || a.bufferView === undefined)
            throw Error('Sparse or missing GLB accessor is unsupported.');
        const b = json.bufferViews[a.bufferView], t = info[a.componentType], count = types[a.type];
        if (!t || !count || b.buffer !== 0)
            throw Error('Unsupported GLB accessor.');
        if (a.count > 2000000)
            throw Error('GLB accessor exceeds import limit.');
        const start = (b.byteOffset || 0) + (a.byteOffset || 0), stride = b.byteStride || t[0] * count, out = [];
        for (let i = 0; i < a.count; i++)
            for (let k = 0; k < count; k++) {
                let x = dv[t[1]](start + i * stride + k * t[0], true);
                if (a.normalized && a.componentType !== 5126)
                    x = Math.max(-1, x / t[2]);
                out.push(x);
            }
        return out;
    };
    const p = [], n = [], uv = [], idx = [];
    const stack = new Set();
    const visit = (id, parent) => {
        if (stack.has(id))
            throw Error('Cyclic GLB node graph.');
        stack.add(id);
        const node = json.nodes[id];
        if (!node)
            throw Error('Invalid GLB node.');
        const matrix = multiply(parent, nodeMatrix(node)), inv = invert(matrix);
        if (node.mesh !== undefined)
            for (const prim of json.meshes[node.mesh].primitives) {
                if ((prim.mode ?? 4) !== 4)
                    throw Error('Only triangle-list GLB primitives are supported.');
                if (prim.targets?.length)
                    throw Error('Bake morph targets before import.');
                const pp = read(prim.attributes.POSITION), uu = read(prim.attributes.TEXCOORD_0), ii = prim.indices === undefined ? Array.from({ length: pp.length / 3 }, (_, i) => i) : read(prim.indices), nn = prim.attributes.NORMAL === undefined ? calculateNormals(new Float32Array(pp), new Uint32Array(ii)) : read(prim.attributes.NORMAL), base = p.length / 3;
                for (let i = 0; i < pp.length; i += 3) {
                    p.push(...transform(matrix, pp.slice(i, i + 3)));
                    const a = nn.slice(i, i + 3);
                    n.push(...normalize([inv[0] * a[0] + inv[1] * a[1] + inv[2] * a[2], inv[4] * a[0] + inv[5] * a[1] + inv[6] * a[2], inv[8] * a[0] + inv[9] * a[1] + inv[10] * a[2]]));
                }
                for (const value of uu)
                    uv.push(value);
                for (const i of ii)
                    idx.push(base + i);
            }
        for (const c of node.children || [])
            visit(c, matrix);
        stack.delete(id);
    };
    for (const root of json.scenes?.[json.scene || 0]?.nodes || [])
        visit(root, identity());
    return fitMesh(validateMesh({ name: 'Imported GLB', positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(uv), indices: new Uint32Array(idx) }));
}
export async function exportGLB(mesh, maps, name = 'Patina material') {
    const chunks = [], bufferViews = [], accessors = [];
    let byteOffset = 0;
    const append = (data, target) => {
        const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength), id = bufferViews.length;
        bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, ...(target ? { target } : {}) });
        chunks.push({ offset: byteOffset, bytes });
        byteOffset += align4(bytes.length);
        return id;
    };
    const attr = (data, type, componentType, target, extra = {}) => {
        const id = accessors.length;
        accessors.push({ bufferView: append(data, target), componentType, count: data.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[type]), type, ...extra });
        return id;
    };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], mesh.positions[i + k]);
            max[k] = Math.max(max[k], mesh.positions[i + k]);
        }
    const position = attr(mesh.positions, 'VEC3', 5126, 34962, { min, max }), normal = attr(mesh.normals, 'VEC3', 5126, 34962), uv = attr(mesh.uvs, 'VEC2', 5126, 34962), indices = attr(mesh.indices, 'SCALAR', 5125, 34963), images = [];
    for (const data of [maps.color, packORM(maps.aux), maps.normal]) {
        images.push({ bufferView: append(await encodePNG(data, maps.resolution)), mimeType: 'image/png' });
    }
    const json = { asset: { version: '2.0', generator: 'PatinaStudio' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices, material: 0 }] }], materials: [{ name, doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 }, metallicFactor: 1, roughnessFactor: 1 }, normalTexture: { index: 2, scale: .62 }, occlusionTexture: { index: 1 } }], textures: images.map((_, i) => ({ source: i, sampler: 0 })), samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 }], images, accessors, bufferViews, buffers: [{ byteLength: byteOffset }] };
    const raw = enc.encode(JSON.stringify(json)), jlen = align4(raw.length), total = 12 + 8 + jlen + 8 + byteOffset, out = new Uint8Array(total), v = new DataView(out.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, total, true);
    v.setUint32(12, jlen, true);
    v.setUint32(16, 0x4e4f534a, true);
    out.fill(32, 20, 20 + jlen);
    out.set(raw, 20);
    v.setUint32(20 + jlen, byteOffset, true);
    v.setUint32(24 + jlen, 0x004e4942, true);
    for (const c of chunks)
        out.set(c.bytes, 28 + jlen + c.offset);
    return out;
}
