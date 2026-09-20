import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, newLayer, validateProject } from '@patina/project';
import { materialById } from '@patina/materials';
import { createCube, serializeMesh, validateMesh } from '@patina/mesh';
function fixture() {
    const p = createProject();
    p.layers = [newLayer('fill', materialById('copper'))];
    p.selectedLayer = p.layers[0].id;
    return p;
}
test('project refuses CSS injection in material color', () => {
    const p = fixture();
    p.layers[0].material.color = '#fff;background:url(https://example.com)';
    assert.throws(() => validateProject(p), /color/);
});
test('project refuses remote and SVG decals', () => {
    for (const uri of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
        const p = fixture();
        p.layers[0].image = uri;
        assert.throws(() => validateProject(p), /image/);
    }
});
test('project refuses prototype-named primitive', () => {
    const p = fixture();
    p.mesh.primitive = 'constructor';
    assert.throws(() => validateProject(p), /primitive/);
});
test('project rejects malformed baked map lengths', () => {
    const p = fixture();
    p.bake = { resolution: 128, geometry: 'AAAA', surface: 'AAAA' };
    assert.throws(() => validateProject(p), /baked/);
});
test('project rejects out-of-range UVs and fractional indices before typed-array conversion', () => {
    const p = fixture();
    p.mesh = { data: serializeMesh(createCube()) };
    p.mesh.data.uvs[0] = 2;
    assert.throws(() => validateProject(p), /UV/);
    p.mesh.data.uvs[0] = .5;
    p.mesh.data.indices[0] = .5;
    assert.throws(() => validateProject(p), /index/);
});
test('project rejects invalid brush bounds before replay', () => {
    const p = fixture();
    p.layers[0].strokes = [{ mode: 0, settings: { color: '#ffffff', radius: Infinity }, points: [[.5, .5, 1]] }];
    assert.throws(() => validateProject(p), /radius/);
});
test('mesh validation rejects non-finite normals', () => {
    const m = createCube();
    m.normals[0] = NaN;
    assert.throws(() => validateMesh(m), /normal/);
});
test('valid serialized mesh project round-trips', () => {
    const p = fixture();
    p.mesh = { data: serializeMesh(createCube()) };
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))).name, p.name);
});
