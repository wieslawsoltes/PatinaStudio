import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, multiply, invert, transform, OrbitCamera, BVH, rayTriangle, normalize, cross, sub, dot } from '@patina/math';
import { createSphere, createCube, createArtifact, createTorus, parseOBJ, exportOBJ, validateMesh, serializeMesh, deserializeMesh } from '@patina/mesh';
import { createProject, newLayer, validateProject, History } from '@patina/project';
import { materialById, presets, sampleMaterial } from '@patina/materials';
import { CPUPaintEngine, StrokeSampler } from '@patina/paint';
import { rasterizeGeometry, computeCurvature, bakeMaps, dilateMaps } from '@patina/baker';
import { crc32, zipFiles, packORM, channelPixels, flipNormalY, nodeMatrix } from '@patina/io';
const near = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
test('matrix inversion preserves a transformed point', () => {
    const m = nodeMatrix({ translation: [2, 3, -4], rotation: [0, Math.sin(.3), 0, Math.cos(.3)], scale: [2, .5, 3] });
    const p = [.3, -.7, 5], q = transform(invert(m), transform(m, p));
    q.forEach((v, i) => near(v, p[i]));
    const id = multiply(m, invert(m));
    id.forEach((v, i) => near(v, identity()[i]));
});
test('singular matrices are rejected', () => assert.throws(() => invert(new Float32Array(16)), /Singular/));
test('camera center ray points at target', () => {
    const camera = new OrbitCamera(), r = camera.ray(0, 0, 1.6);
    near(dot(r.direction, normalize(sub(camera.target, camera.eye))), 1);
});
test('ray triangle returns barycentric coordinates and rejects parallel rays', () => {
    const h = rayTriangle([.2, .3, 1], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    near(h.t, 1);
    near(h.u, .2);
    near(h.v, .3);
    assert.equal(rayTriangle([0, 0, 1], [1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]), null);
});
for (const [label, make] of [['sphere', createSphere], ['artifact', createArtifact], ['cube', createCube], ['torus', createTorus]])
    test(`${label} primitive has finite, normalized geometry and bounded UVs`, () => {
        const m = validateMesh(make());
        assert.ok(m.indices.length > 0);
        for (let i = 0; i < m.normals.length; i += 3)
            near(Math.hypot(...m.normals.subarray(i, i + 3)), 1, 1e-4);
        for (const u of m.uvs)
            assert.ok(u >= 0 && u <= 1);
    });
test('sphere winding agrees with vertex normals', () => {
    const m = createSphere();
    for (let t = 1500; t < 1600; t += 3) {
        const [a, b, c] = Array.from(m.indices.subarray(t, t + 3), i => m.positions.subarray(i * 3, i * 3 + 3));
        const n = m.normals.subarray(m.indices[t] * 3, m.indices[t] * 3 + 3);
        assert.ok(dot(cross(sub(b, a), sub(c, a)), n) > 0);
    }
});
test('BVH reports front face UV and misses off-axis rays', () => {
    const m = createCube(), bvh = new BVH(m), h = bvh.hit([0, 0, 3], [0, 0, -1]);
    assert.ok(h);
    near(h.position[2], .8);
    assert.ok(h.uv.every(v => v >= 0 && v <= 1));
    assert.equal(bvh.hit([4, 0, 3], [0, 0, -1]), null);
});
test('OBJ supports negative indices and polygon triangulation', () => {
    const mesh = parseOBJ('v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf -4/-4 -3/-3 -2/-2 -1/-1');
    assert.equal(mesh.indices.length, 6);
    assert.equal(mesh.positions.length, 12);
    assert.ok(mesh.normals[2] > .99);
});
test('OBJ missing UVs fails explicitly', () => assert.throws(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'), /UV/));
test('OBJ export and import preserve triangle count', () => {
    const m = createCube(), r = parseOBJ(exportOBJ(m));
    assert.equal(r.indices.length, m.indices.length);
    r.uvs.forEach((v, i) => near(v, m.uvs[i]));
});
test('mesh serialization round trips', () => {
    const m = createCube(), r = deserializeMesh(serializeMesh(m));
    assert.deepEqual(r.positions, m.positions);
    assert.deepEqual(r.indices, m.indices);
});
test('history supports branch-safe undo and redo', () => {
    const p = createProject(), h = new History(2);
    h.push(p, 'rename');
    p.name = 'First';
    const undo = h.undo(p);
    assert.equal(undo.project.name, 'Artifact 07');
    const redo = h.redo(undo.project);
    assert.equal(redo.project.name, 'First');
    h.push(redo.project, 'branch');
    assert.equal(h.future.length, 0);
});
test('history bounds the checkpoint count', () => {
    const p = createProject(), h = new History(2);
    for (let i = 0; i < 8; i++) {
        p.name = String(i);
        h.push(p);
    }
    assert.equal(h.past.length, 2);
});
test('project rejects unsupported versions, resolutions and duplicate IDs', () => {
    const p = createProject();
    p.layers = [newLayer()];
    validateProject(p);
    assert.throws(() => validateProject({ ...p, version: 99 }));
    assert.throws(() => validateProject({ ...p, resolution: 8192 }));
    p.layers.push(structuredClone(p.layers[0]));
    assert.throws(() => validateProject(p), /Duplicate/);
});
test('every procedural material returns bounded PBR channels', () => {
    for (const p of presets)
        for (const [u, v] of [[0, 0], [.33, .74], [1, 1]]) {
            const s = sampleMaterial(p, u, v);
            for (const c of [...s.color, s.metallic, s.roughness, s.height])
                assert.ok(Number.isFinite(c) && c >= 0 && c <= 1);
        }
});
test('stroke sampler spaces stamps and does not bridge UV seams', () => {
    const s = new StrokeSampler(.02, .5);
    assert.equal(s.add(.1, .2).length, 1);
    assert.equal(s.add(.15, .2).length, 4);
    const seam = s.add(.95, .2);
    assert.equal(seam.length, 1);
    near(seam[0][0], .95);
});
test('UV rasterization contains visible pixels and normals', () => {
    const m = rasterizeGeometry(createCube(), 32);
    assert.ok(m.triangles.some(t => t >= 0));
    let covered = 0;
    for (let i = 2; i < m.surface.length; i += 4)
        if (m.surface[i])
            covered++;
    assert.ok(covered > 500);
    assert.ok(m.geometry.every(Number.isFinite));
});
test('welded curvature is finite across UV seams', () => {
    const c = computeCurvature(createSphere());
    assert.ok(c.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});
test('AO baking returns valid maps and reports progress', async () => {
    let progress = 0;
    const m = await bakeMaps(createCube(), { resolution: 16, samples: 2, BVH, onProgress: p => progress = p });
    assert.equal(m.geometry.length, 16 * 16 * 4);
    assert.equal(progress, 1);
    assert.ok(m.surface.every(x => x >= 0 && x <= 255));
});
test('AO baking can be cancelled', async () => {
    await assert.rejects(() => bakeMaps(createCube(), { resolution: 16, samples: 2, BVH, cancelled: () => true }), { name: 'AbortError' });
});
test('CPU brush painting, erase and mask semantics are functional', async () => {
    const p = createProject();
    p.resolution = 256;
    const l = newLayer();
    p.layers = [l];
    const e = await new CPUPaintEngine(null, 32).init();
    await e.sync(p);
    const stroke = { mode: 0, settings: { radius: .14, color: '#ff0000', metallic: .7, roughness: .3, height: .6, hardness: .9, flow: 1, shape: 0, pressureSize: false, pressureOpacity: false }, points: [[.5, .5, 1]] };
    e.paint(l.id, stroke, stroke.points);
    let s = e.layers.get(l.id);
    assert.equal(s.color[(16 * 32 + 16) * 4], 255);
    assert.equal(s.color[(16 * 32 + 16) * 4 + 3], 255);
    e.paint(l.id, { ...stroke, mode: 1 }, stroke.points);
    assert.equal(s.color[(16 * 32 + 16) * 4 + 3], 0);
    e.paint(l.id, { ...stroke, mode: 3 }, stroke.points);
    assert.equal(s.mask[(16 * 32 + 16) * 4], 0);
});
test('CPU compositor produces a non-flat height normal and layer ordering', async () => {
    const p = createProject(), base = newLayer('fill', materialById('ceramic')), l = newLayer();
    p.layers = [base, l];
    const e = await new CPUPaintEngine(null, 32).init();
    await e.sync(p);
    const stroke = { mode: 0, settings: { radius: .15, color: '#ff0000', metallic: 1, roughness: .2, height: .8, hardness: .5, flow: 1, shape: 0, pressureSize: false, pressureOpacity: false }, points: [[.5, .5, 1]] };
    e.paint(l.id, stroke, stroke.points);
    const m = e.composite(p), i = (16 * 32 + 16) * 4;
    assert.ok(m.color[i] > 240 && m.color[i + 1] < 30);
    assert.ok(m.normal.some((v, i) => i % 4 === 0 && Math.abs(v - 128) > 5));
    l.visible = false;
    const hidden = e.composite(p);
    assert.ok(hidden.color[i + 1] > 150);
});
test('ORM and normal-convention conversion are explicit', () => {
    const aux = new Uint8ClampedArray([10, 20, 30, 40]);
    assert.deepEqual(Array.from(packORM(aux)), [40, 20, 10, 255]);
    assert.deepEqual(Array.from(channelPixels(aux, 2)), [30, 30, 30, 255]);
    assert.deepEqual(Array.from(flipNormalY(aux)), [10, 235, 30, 40]);
});
test('ZIP emits valid CRC and central directory', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    const zip = zipFiles({ 'readme.txt': 'hello', 'bytes.bin': new Uint8Array([0, 1, 2]) }), dv = new DataView(zip.buffer);
    assert.equal(dv.getUint32(0, true), 0x04034b50);
    assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
    assert.equal(dv.getUint16(zip.length - 14, true), 2);
});
