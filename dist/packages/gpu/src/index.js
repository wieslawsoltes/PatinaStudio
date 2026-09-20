import { fillWGSL, brushWGSL, compositeWGSL, normalWGSL } from './kernels.js';
/** Owns a WebGPU device, with validation surfaced rather than silently ignored. */
export class GPUContext {
    static async create() {
        if (!globalThis.navigator?.gpu)
            throw Error('WebGPU is not available.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter)
            throw Error('No WebGPU adapter.');
        const device = await adapter.requestDevice();
        return new GPUContext(adapter, device);
    }
    constructor(adapter, device) {
        this.adapter = adapter;
        this.device = device;
        this.errors = [];
        this.onError = null;
        device.addEventListener('uncapturederror', e => {
            this.errors.push(e.error.message);
            console.error('WebGPU:', e.error.message);
            this.onError?.(e.error);
        });
        device.lost.then(info => {
            if (info.reason !== 'destroyed') {
                this.errors.push(info.message);
                this.onLost?.(info);
            }
        });
    }
    texture(size, label = 'texture') {
        return this.device.createTexture({ label, size: typeof size === 'number' ? [size, size] : size, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    }
    buffer(bytes, usage, label) {
        return this.device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage, label });
    }
    upload(texture, data, width, height = width) {
        this.device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
    }
    async module(code, label) {
        const m = this.device.createShaderModule({ code, label }), info = await m.getCompilationInfo();
        const errors = info.messages.filter(x => x.type === 'error');
        if (errors.length)
            throw Error(label + ': ' + errors.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('\n'));
        return m;
    }
    async compute(code, label) {
        return this.device.createComputePipelineAsync({ label, layout: 'auto', compute: { module: await this.module(code, label), entryPoint: 'main' } });
    }
    bind(pipeline, resources) {
        return this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.map((r, binding) => ({ binding, resource: r instanceof GPUTexture ? r.createView() : r instanceof GPUBuffer ? { buffer: r } : r })) });
    }
    async read(texture, width = texture.width, height = texture.height) {
        const row = Math.ceil(width * 4 / 256) * 256, b = this.buffer(row * height, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, 'texture readback'), enc = this.device.createCommandEncoder();
        enc.copyTextureToBuffer({ texture }, { buffer: b, bytesPerRow: row, rowsPerImage: height }, [width, height]);
        this.device.queue.submit([enc.finish()]);
        try {
            await b.mapAsync(GPUMapMode.READ);
            const src = new Uint8Array(b.getMappedRange()), out = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < height; y++)
                out.set(src.subarray(y * row, y * row + width * 4), y * width * 4);
            return out;
        }
        finally {
            b.unmap();
            b.destroy();
        }
    }
    destroy() {
        this.device.destroy();
    }
}
export { fillWGSL, brushWGSL, compositeWGSL, normalWGSL };
