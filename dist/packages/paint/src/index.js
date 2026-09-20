import { hexToRGB, sampleMaterial, noise, fbm, hash } from '@patina/materials';
import { fillWGSL, brushWGSL, compositeWGSL, normalWGSL } from '@patina/gpu';
const clamp = x => Math.max(0, Math.min(1, x));
const blends = ['normal', 'multiply', 'screen', 'overlay', 'add'];
const generators = ['none', 'edge', 'cavity', 'oxidation', 'dirt', 'noise'];
const contentKey = l => JSON.stringify([l.type, l.material, l.strokes, l.mask, l.image]);
/** Pressure-aware, distance-resampled brush path in normalized texture space. */
export class StrokeSampler {
    constructor(radius, spacing = .16) {
        this.radius = radius;
        this.spacing = spacing;
        this.last = null;
        this.carry = 0;
    }
    reset() {
        this.last = null;
        this.carry = 0;
    }
    add(u, v, pressure = 1) {
        const current = [u, v, pressure];
        if (!this.last) {
            this.last = current;
            return [current];
        }
        const last = this.last, dx = u - last[0], dy = v - last[1], d = Math.hypot(dx, dy), step = Math.max(.0002, this.radius * this.spacing), out = [];
        if (d > .18) {
            this.last = current;
            this.carry = 0;
            return [current];
        }
        for (let t = step - this.carry; t <= d; t += step) {
            const f = t / d;
            out.push([last[0] + dx * f, last[1] + dy * f, last[2] + (pressure - last[2]) * f]);
        }
        this.carry = (this.carry + d) % step;
        this.last = current;
        return out;
    }
}
export class GPUPaintEngine {
    constructor(gpu, resolution) {
        this.gpu = gpu;
        this.device = gpu.device;
        this.size = resolution;
        this.layers = new Map();
        this.dispatches = 0;
    }
    async init() {
        const g = this.gpu;
        [this.fillPipeline, this.brushPipeline, this.compositePipeline, this.normalPipeline] = await Promise.all([g.compute(fillWGSL, 'Material generation'), g.compute(brushWGSL, 'Pressure brush'), g.compute(compositeWGSL, 'Layer compositor'), g.compute(normalWGSL, 'Height to normal')]);
        this.uniform = g.buffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'compute parameters');
        this.stampBuffer = g.buffer(64 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'brush stamps');
        this.ping = [this.createTextures(), this.createTextures()];
        this.normal = g.texture(this.size, 'derived normal');
        this.geometry = g.texture(1, 'geometry normal / curvature');
        this.meshMaps = g.texture(1, 'AO / position / coverage');
        g.upload(this.geometry, new Uint8Array([128, 128, 255, 128]), 1);
        g.upload(this.meshMaps, new Uint8Array([255, 128, 255, 255]), 1);
        this.blank = this.createTextures();
        this.fill(this.blank, null, 1, 1);
        return this;
    }
    createTextures() {
        return { color: this.gpu.texture(this.size, 'base color'), aux: this.gpu.texture(this.size, 'metal rough height alpha'), mask: this.gpu.texture(this.size, 'layer mask') };
    }
    releaseTextures(t) {
        for (const v of Object.values(t))
            v.destroy();
    }
    run(pipeline, resources, width = this.size, height = this.size) {
        const enc = this.device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.gpu.bind(pipeline, resources));
        pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        pass.end();
        this.device.queue.submit([enc.finish()]);
        this.dispatches++;
    }
    fill(out, material, alpha = 1, maskBase = 1) {
        const m = material || { color: '#888888', secondary: '#888888', metallic: 0, roughness: .5, height: .5, detail: 0, scale: 1, pattern: 0 }, data = new Float32Array([...hexToRGB(m.color), alpha, ...hexToRGB(m.secondary), 0, m.metallic, m.roughness, m.height, m.detail, m.scale, m.pattern, maskBase, 0]);
        this.device.queue.writeBuffer(this.uniform, 0, data);
        this.run(this.fillPipeline, [this.uniform, out.color, out.aux, out.mask]);
    }
    async sync(project) {
        const ids = new Set(project.layers.map(l => l.id));
        for (const [id, s] of this.layers)
            if (!ids.has(id)) {
                this.releaseTextures(s.front);
                this.releaseTextures(s.back);
                this.layers.delete(id);
            }
        for (const l of project.layers) {
            const key = contentKey(l);
            let s = this.layers.get(l.id);
            if (s?.key === key)
                continue;
            if (!s) {
                s = { front: this.createTextures(), back: this.createTextures() };
                this.layers.set(l.id, s);
            }
            this.fill(s.front, l.type === 'fill' ? l.material : null, l.type === 'fill' ? 1 : 0, l.mask?.base ?? 1);
            if (l.image) {
                await this.uploadImage(l.id, l.image);
            }
            for (const stroke of l.strokes)
                this.paint(l.id, stroke, stroke.points);
            for (const stroke of l.mask?.strokes || [])
                this.paint(l.id, stroke, stroke.points);
            s.key = key;
        }
    }
    markSynced(layer) {
        const s = this.layers.get(layer.id);
        if (s)
            s.key = contentKey(layer);
    }
    paint(layerId, stroke, points) {
        const s = this.layers.get(layerId);
        if (!s || !points.length)
            return;
        const N = this.size, settings = stroke.settings;
        for (let off = 0; off < points.length; off += 64) {
            const batch = points.slice(off, off + 64), data = new Float32Array(batch.length * 4);
            let minX = N, minY = N, maxX = 0, maxY = 0;
            batch.forEach(([u, v, p], i) => {
                const r = Math.max(.7, settings.radius * N * (settings.pressureSize ? .35 + .65 * p : 1));
                data.set([u * N, v * N, r, settings.flow * (settings.pressureOpacity ? p : 1)], i * 4);
                const e = settings.shape === 3 ? r * 3.5 : r;
                minX = Math.min(minX, u * N - e - 1);
                minY = Math.min(minY, v * N - e - 1);
                maxX = Math.max(maxX, u * N + e + 1);
                maxY = Math.max(maxY, v * N + e + 1);
            });
            minX = Math.max(0, Math.floor(minX));
            minY = Math.max(0, Math.floor(minY));
            maxX = Math.min(N, Math.ceil(maxX));
            maxY = Math.min(N, Math.ceil(maxY));
            const w = maxX - minX, h = maxY - minY;
            if (w <= 0 || h <= 0)
                continue;
            const config = new Float32Array([...hexToRGB(settings.color), 1, settings.metallic, settings.roughness, settings.height, 1, settings.hardness, settings.shape, stroke.mode || 0, batch.length, minX, minY, w, h]);
            this.device.queue.writeBuffer(this.uniform, 0, config);
            this.device.queue.writeBuffer(this.stampBuffer, 0, data);
            const enc = this.device.createCommandEncoder();
            for (const key of ['color', 'aux', 'mask'])
                enc.copyTextureToTexture({ texture: s.front[key] }, { texture: s.back[key] }, [N, N]);
            const pass = enc.beginComputePass();
            pass.setPipeline(this.brushPipeline);
            pass.setBindGroup(0, this.gpu.bind(this.brushPipeline, [this.uniform, this.stampBuffer, s.front.color, s.front.aux, s.front.mask, s.back.color, s.back.aux, s.back.mask]));
            pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
            pass.end();
            this.device.queue.submit([enc.finish()]);
            [s.front, s.back] = [s.back, s.front];
            this.dispatches++;
        }
    }
    async uploadImage(id, url) {
        const s = this.layers.get(id), image = await createImageBitmap(await (await fetch(url)).blob()), canvas = new OffscreenCanvas(this.size, this.size), ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, this.size, this.size);
        image.close();
        const im = ctx.getImageData(0, 0, this.size, this.size);
        this.gpu.upload(s.front.color, im.data, this.size);
        const aux = new Uint8Array(im.data.length);
        for (let i = 0; i < aux.length; i += 4)
            aux.set([0, 128, 128, im.data[i + 3]], i);
        this.gpu.upload(s.front.aux, aux, this.size);
    }
    setGeometry(maps) {
        this.geometry.destroy();
        this.meshMaps.destroy();
        this.geometry = this.gpu.texture(maps.resolution, 'geometry');
        this.meshMaps = this.gpu.texture(maps.resolution, 'mesh maps');
        this.gpu.upload(this.geometry, maps.geometry, maps.resolution);
        this.gpu.upload(this.meshMaps, maps.surface, maps.resolution);
    }
    composite(project) {
        let input = this.blank;
        let i = 0;
        for (const layer of project.layers) {
            if (!layer.visible || layer.opacity <= 0)
                continue;
            const s = this.layers.get(layer.id);
            if (!s)
                continue;
            const out = this.ping[i++ % 2], data = new Float32Array([layer.opacity, blends.indexOf(layer.blend), +(layer.mask?.enabled || false), Math.max(0, generators.indexOf(layer.generator)), ...layer.channels.map(Number), layer.generatorAmount ?? .5, 0, 0, 0]);
            this.device.queue.writeBuffer(this.uniform, 0, data);
            this.run(this.compositePipeline, [this.uniform, input.color, input.aux, s.front.color, s.front.aux, s.front.mask, this.geometry, this.meshMaps, out.color, out.aux]);
            input = out;
        }
        this.output = input;
        this.run(this.normalPipeline, [input.aux, this.normal]);
        return { color: input.color, aux: input.aux, normal: this.normal };
    }
    async read() {
        return { color: await this.gpu.read(this.output.color), aux: await this.gpu.read(this.output.aux), normal: await this.gpu.read(this.normal), resolution: this.size };
    }
    dispose() {
        for (const s of this.layers.values()) {
            this.releaseTextures(s.front);
            this.releaseTextures(s.back);
        }
        for (const t of [...this.ping, this.blank])
            this.releaseTextures(t);
        this.normal.destroy();
        this.geometry.destroy();
        this.meshMaps.destroy();
        this.uniform.destroy();
        this.stampBuffer.destroy();
    }
}
function smooth(a, b, x) {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
}
const over = (d, i, c, a) => {
    const old = d[i + 3] / 255, oa = a + old * (1 - a);
    for (let k = 0; k < 3; k++)
        d[i + k] = oa ? (c[k] * a + d[i + k] / 255 * old * (1 - a)) / oa * 255 : 0;
    d[i + 3] = oa * 255;
};
/** Portable CPU reference backend: all edits and exports remain functional without WebGPU. */
export class CPUPaintEngine {
    constructor(_, resolution) {
        this.size = resolution;
        this.layers = new Map();
        this.dispatches = 0;
    }
    async init() {
        return this;
    }
    async sync(project) {
        for (const id of this.layers.keys())
            if (!project.layers.some(l => l.id === id))
                this.layers.delete(id);
        for (const l of project.layers) {
            const key = contentKey(l);
            if (this.layers.get(l.id)?.key === key)
                continue;
            const N = this.size, len = N * N * 4, s = { color: new Uint8ClampedArray(len), aux: new Uint8ClampedArray(len), mask: new Uint8ClampedArray(len), key };
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    const i = (y * N + x) * 4, m = l.type === 'fill' ? sampleMaterial(l.material, x / N, y / N) : null;
                    if (m) {
                        s.color.set([...m.color.map(v => v * 255), 255], i);
                        s.aux.set([m.metallic * 255, m.roughness * 255, m.height * 255, 255], i);
                    }
                    s.mask.set([255 * (l.mask?.base ?? 1), 255, 255, 255], i);
                }
                if (y % 64 === 0)
                    await new Promise(r => setTimeout(r, 0));
            }
            this.layers.set(l.id, s);
            if (l.image) {
                const im = await createImageBitmap(await (await fetch(l.image)).blob()), c = new OffscreenCanvas(N, N), ctx = c.getContext('2d');
                ctx.drawImage(im, 0, 0, N, N);
                im.close();
                s.color = ctx.getImageData(0, 0, N, N).data;
                for (let i = 0; i < len; i += 4)
                    s.aux.set([0, 128, 128, s.color[i + 3]], i);
            }
            for (const stroke of [...l.strokes, ...l.mask?.strokes || []])
                this.paint(l.id, stroke, stroke.points);
        }
    }
    markSynced(l) {
        if (this.layers.has(l.id))
            this.layers.get(l.id).key = contentKey(l);
    }
    paint(id, stroke, points) {
        const s = this.layers.get(id), N = this.size, b = stroke.settings, col = hexToRGB(b.color), aux = [b.metallic, b.roughness, b.height];
        if (!s)
            return;
        for (const [u, v, p] of points) {
            const cx = u * N, cy = v * N, r = Math.max(.7, b.radius * N * (b.pressureSize ? .35 + .65 * p : 1)), extent = b.shape === 3 ? r * 3.5 : r;
            for (let y = Math.max(0, Math.floor(cy - extent)); y < Math.min(N, cy + extent); y++)
                for (let x = Math.max(0, Math.floor(cx - extent)); x < Math.min(N, cx + extent); x++) {
                    const dx = (x + .5 - cx) / r, dy = (y + .5 - cy) / r, d = b.shape === 4 ? Math.max(Math.abs(dx), Math.abs(dy)) : b.shape === 3 ? Math.hypot(dx * .3, dy * 4) : Math.hypot(dx, dy);
                    let a = (1 - smooth(Math.min(b.hardness, .99), 1, d)) * b.flow * (b.pressureOpacity ? p : 1);
                    if (b.shape === 1)
                        a *= smooth(.15, .8, hash(x, y));
                    if (b.shape === 2)
                        a *= (hash(x + cx, y + cy) > .77 ? .75 : 0);
                    if (a <= 0)
                        continue;
                    const i = (y * N + x) * 4;
                    if (stroke.mode === 1) {
                        s.color[i + 3] *= 1 - a;
                        s.aux[i + 3] *= 1 - a;
                    }
                    else if (stroke.mode >= 2)
                        s.mask[i] = s.mask[i] * (1 - a) + (stroke.mode === 3 ? 0 : 255) * a;
                    else {
                        over(s.color, i, col, a);
                        over(s.aux, i, aux, a);
                    }
                }
        }
    }
    setGeometry(m) {
        this.maps = m;
    }
    composite(project) {
        const N = this.size, len = N * N * 4, color = new Uint8ClampedArray(len), aux = new Uint8ClampedArray(len);
        for (let i = 0; i < len; i += 4) {
            color.set([136, 136, 136, 255], i);
            aux.set([0, 128, 128, 255], i);
        }
        for (const l of project.layers) {
            if (!l.visible || !l.opacity)
                continue;
            const s = this.layers.get(l.id);
            if (!s)
                continue;
            for (let y = 0; y < N; y++)
                for (let x = 0; x < N; x++) {
                    const i = (y * N + x) * 4, u = x / N, v = y / N, mi = this.maps ? (Math.min(this.maps.resolution - 1, Math.floor(v * this.maps.resolution)) * this.maps.resolution + Math.min(this.maps.resolution - 1, Math.floor(u * this.maps.resolution))) * 4 : 0, g = this.maps ? this.maps.geometry[mi + 3] / 255 : .5, ao = this.maps ? this.maps.surface[mi] / 255 : 1, py = this.maps ? this.maps.surface[mi + 1] / 255 : .5, amount = l.generatorAmount ?? .5;
                    let mask = l.mask?.enabled ? s.mask[i] / 255 : 1;
                    if (l.generator === 'edge')
                        mask *= smooth(.5 + amount * .18, .56 + amount * .3, g);
                    if (l.generator === 'cavity')
                        mask *= 1 - smooth(.28 + amount * .22, .48 + amount * .15, g);
                    if (l.generator === 'oxidation')
                        mask *= smooth(amount - .13, amount + .13, fbm(u * 8, v * 8) + (.5 - g) * .32);
                    if (l.generator === 'dirt')
                        mask *= (1 - ao) * smooth(amount - .25, amount + .2, fbm(u * 6, v * 6)) + .25 * (1 - py);
                    if (l.generator === 'noise')
                        mask *= smooth(amount - .06, amount + .06, fbm(u * 12, v * 12));
                    const a = clamp(s.color[i + 3] / 255 * l.opacity * mask);
                    if (l.channels[0])
                        for (let k = 0; k < 3; k++) {
                            let c = (s.color[i + k] / 255) ** 2.2, base = (color[i + k] / 255) ** 2.2;
                            if (l.blend === 'multiply')
                                c *= base;
                            if (l.blend === 'screen')
                                c = 1 - (1 - c) * (1 - base);
                            if (l.blend === 'overlay')
                                c = base > .5 ? 1 - 2 * (1 - base) * (1 - c) : 2 * base * c;
                            if (l.blend === 'add')
                                c = Math.min(1, c + base);
                            color[i + k] = (base + (c - base) * a) ** (1 / 2.2) * 255;
                        }
                    for (let k = 0; k < 3; k++)
                        if (l.channels[k + 1])
                            aux[i + k] += (s.aux[i + k] - aux[i + k]) * a;
                    aux[i + 3] = ao * 255;
                }
        }
        const normal = new Uint8ClampedArray(len);
        for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++) {
                const h = (xx, yy) => aux[(Math.max(0, Math.min(N - 1, yy)) * N + Math.max(0, Math.min(N - 1, xx))) * 4 + 2] / 255, dx = (h(x - 1, y) - h(x + 1, y)) * 4, dy = (h(x, y + 1) - h(x, y - 1)) * 4, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
                normal.set([(dx / l * .5 + .5) * 255, (dy / l * .5 + .5) * 255, (1 / l * .5 + .5) * 255, 255], i);
            }
        return this.output = { color, aux, normal, resolution: N };
    }
    async read() {
        return this.output;
    }
    dispose() {
        this.layers.clear();
    }
}
