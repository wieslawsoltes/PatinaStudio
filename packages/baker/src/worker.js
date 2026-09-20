import { bakeMaps } from './index.js';
self.onmessage = async ({ data }) => {
    try {
        const { BVH } = await import(data.mathURL);
        const maps = await bakeMaps(data.mesh, { ...data.options, BVH, onProgress: value => self.postMessage({ type: 'progress', value }) });
        self.postMessage({ type: 'done', maps }, [maps.geometry.buffer, maps.surface.buffer, maps.positions.buffer, maps.normals.buffer, maps.triangles.buffer]);
    }
    catch (e) {
        self.postMessage({ type: 'error', message: e.message });
    }
};
