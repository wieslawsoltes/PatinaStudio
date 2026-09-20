import { invert } from '@patina/math';
import { meshWGSL, fullscreenWGSL } from './shaders.js';
export class GPURenderer {
    constructor(canvas, gpu) {
        this.canvas = canvas;
        this.gpu = gpu;
        this.device = gpu.device;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context = canvas.getContext('webgpu');
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
        this.exposure = 1.1;
        this.environment = 0;
        this.rotation = 0;
        this.channel = 0;
        this.wireframe = false;
        this.frames = 0;
    }
    async init() {
        const d = this.device;
        this.uniform = d.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.uvUniform = d.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
        const mesh = await this.gpu.module(meshWGSL, 'PBR surface'), full = await this.gpu.module(fullscreenWGSL, 'Studio and UV');
        this.layout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, ...[2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }))] });
        const layout = d.createPipelineLayout({ bindGroupLayouts: [this.layout] });
        const buffers = [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }];
        this.pipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: mesh, entryPoint: 'vs', buffers }, fragment: { module: mesh, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 } });
        this.wirePipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: mesh, entryPoint: 'vs', buffers }, fragment: { module: mesh, entryPoint: 'wire', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'line-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }, multisample: { count: 4 } });
        this.backgroundPipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: full, entryPoint: 'vs' }, fragment: { module: full, entryPoint: 'background', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }, multisample: { count: 4 } });
        this.uvPipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: full, entryPoint: 'vs' }, fragment: { module: full, entryPoint: 'uvFragment', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
        return this;
    }
    setMesh(mesh) {
        this.vertex?.destroy();
        this.index?.destroy();
        this.lineIndex?.destroy();
        const data = new Float32Array(mesh.positions.length / 3 * 8);
        for (let i = 0; i < mesh.positions.length / 3; i++) {
            data.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 8);
            data.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3);
            data.set(mesh.uvs.subarray(i * 2, i * 2 + 2), i * 8 + 6);
        }
        this.vertex = this.gpu.buffer(data.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'mesh vertices');
        this.index = this.gpu.buffer(mesh.indices.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'mesh triangles');
        this.device.queue.writeBuffer(this.vertex, 0, data);
        this.device.queue.writeBuffer(this.index, 0, mesh.indices);
        this.indexCount = mesh.indices.length;
        const lines = new Uint32Array(mesh.indices.length * 2);
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const [a, b, c] = mesh.indices.subarray(i, i + 3);
            lines.set([a, b, b, c, c, a], i * 2);
        }
        this.lineIndex = this.gpu.buffer(lines.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'mesh wireframe');
        this.device.queue.writeBuffer(this.lineIndex, 0, lines);
        this.lineCount = lines.length;
    }
    bind(uniform) {
        return this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: this.sampler }, ...[this.maps.color, this.maps.aux, this.maps.normal].map((t, i) => ({ binding: i + 2, resource: t.createView() }))] });
    }
    setMaps(maps) {
        this.maps = maps;
        this.bindGroup = this.bind(this.uniform);
        this.uvBindGroup = this.bind(this.uvUniform);
    }
    resize() {
        const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.floor(rect.width * dpr)), h = Math.max(1, Math.floor(rect.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h || !this.depth) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.depth?.destroy();
            this.msaa?.destroy();
            this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
            this.msaa = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        }
        return [w, h];
    }
    render(camera) {
        if (!this.maps || !this.vertex)
            return;
        const [w, h] = this.resize(), m = camera.matrix(w / h), u = new Float32Array(64);
        u.set(m);
        u.set(invert(m), 16);
        u.set([...camera.eye, 1], 32);
        u.set([this.exposure, this.rotation, this.channel, 0], 36);
        u.set([w, h, this.environment, 1], 40);
        this.device.queue.writeBuffer(this.uniform, 0, u);
        const enc = this.device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: { r: .1, g: .12, b: .11, a: 1 }, loadOp: 'clear', storeOp: 'discard' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        pass.setBindGroup(0, this.bindGroup);
        pass.setPipeline(this.backgroundPipeline);
        pass.draw(3);
        pass.setPipeline(this.pipeline);
        pass.setVertexBuffer(0, this.vertex);
        pass.setIndexBuffer(this.index, 'uint32');
        pass.drawIndexed(this.indexCount);
        if (this.wireframe) {
            pass.setPipeline(this.wirePipeline);
            pass.setIndexBuffer(this.lineIndex, 'uint32');
            pass.drawIndexed(this.lineCount);
        }
        pass.end();
        this.device.queue.submit([enc.finish()]);
        this.frames++;
    }
    renderUV(canvas, zoom = 1) {
        if (!this.maps)
            return;
        if (this.uvCanvas !== canvas) {
            this.uvCanvas = canvas;
            this.uvContext = canvas.getContext('webgpu');
            this.uvContext.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
        }
        const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(r.width * dpr));
        canvas.height = Math.max(1, Math.floor(r.height * dpr));
        const u = new Float32Array(64);
        u.set([this.exposure, this.rotation, this.channel, 0], 36);
        u.set([canvas.width, canvas.height, 0, zoom], 40);
        this.device.queue.writeBuffer(this.uvUniform, 0, u);
        const enc = this.device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [{ view: this.uvContext.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .1, g: .12, b: .1, a: 1 } }] });
        pass.setPipeline(this.uvPipeline);
        pass.setBindGroup(0, this.uvBindGroup);
        pass.draw(3);
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }
    dispose() {
        for (const b of [this.vertex, this.index, this.lineIndex, this.uniform, this.uvUniform, this.depth, this.msaa])
            b?.destroy();
        this.context.unconfigure();
        this.uvContext?.unconfigure();
    }
}
const vsGL = `#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec3 normal;layout(location=2)in vec2 uv;uniform mat4 mvp;out vec3 P;out vec3 N;out vec2 UV;void main(){P=position;N=normal;UV=uv;gl_Position=mvp*vec4(position,1.);gl_Position.z=gl_Position.z*2.-gl_Position.w;}`;
const fsGL = `#version 300 es
precision highp float;in vec3 P;in vec3 N;in vec2 UV;uniform sampler2D colorMap;uniform sampler2D auxMap;uniform sampler2D normalMap;uniform vec3 eye;uniform float exposure;uniform int channel;out vec4 outColor;
vec3 aces(vec3 c){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);}
void main(){vec3 albedo=texture(colorMap,UV).rgb;vec4 aux=texture(auxMap,UV);vec3 base=pow(albedo,vec3(2.2));vec3 n=normalize(N),v=normalize(eye-P),l=normalize(vec3(-3,4,4)),h=normalize(v+l);float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.);float rough=max(.08,aux.g),a=rough*rough,k=(rough+1.)*(rough+1.)/8.;float den=nh*nh*(a*a-1.)+1.;float D=a*a/(3.14159*den*den+.0001);float G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);vec3 f0=mix(vec3(.04),base,aux.r);vec3 F=f0+(1.-f0)*pow(1.-max(dot(v,h),0.),5.);vec3 c=((1.-F)*(1.-aux.r)*base/3.14159+D*G*F/max(4.*nl*nv,.001))*vec3(4.2,3.65,2.9)*nl;vec3 r=reflect(-v,n);vec3 env=mix(vec3(.05,.065,.06),vec3(.6,.75,.8),smoothstep(-.2,.8,r.y));env+=vec3(2.4,2.1,1.5)*pow(max(dot(r,normalize(vec3(-.6,.65,.6))),0.),mix(100.,2.5,rough));c+=(base*(1.-aux.r)*.2+env*f0*.75)*aux.a;c=pow(aces(c*exposure),vec3(1./2.2));if(channel==1)c=albedo;if(channel==2)c=vec3(aux.g);if(channel==3)c=vec3(aux.r);if(channel==4)c=n*.5+.5;if(channel==5)c=vec3(aux.b);if(channel==6)c=vec3(aux.a);if(channel==7)c=vec3(mod(floor(UV.x*16.)+floor(UV.y*16.),2.)*.5+.2);outColor=vec4(c,1.);}`;
export class GLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
        if (!this.gl)
            throw Error('Neither WebGPU nor WebGL2 is available.');
        this.exposure = 1.1;
        this.rotation = 0;
        this.environment = 0;
        this.channel = 0;
        this.wireframe = false;
        this.frames = 0;
    }
    async init() {
        const g = this.gl, compile = (type, src) => {
            const s = g.createShader(type);
            g.shaderSource(s, src);
            g.compileShader(s);
            if (!g.getShaderParameter(s, g.COMPILE_STATUS))
                throw Error(g.getShaderInfoLog(s));
            return s;
        };
        this.program = g.createProgram();
        g.attachShader(this.program, compile(g.VERTEX_SHADER, vsGL));
        g.attachShader(this.program, compile(g.FRAGMENT_SHADER, fsGL));
        g.linkProgram(this.program);
        if (!g.getProgramParameter(this.program, g.LINK_STATUS))
            throw Error(g.getProgramInfoLog(this.program));
        g.useProgram(this.program);
        for (const [i, name] of ['colorMap', 'auxMap', 'normalMap'].entries())
            g.uniform1i(g.getUniformLocation(this.program, name), i);
        this.textures = [0, 1, 2].map(() => g.createTexture());
        return this;
    }
    setMesh(mesh) {
        const g = this.gl;
        this.vao && g.deleteVertexArray(this.vao);
        this.vao = g.createVertexArray();
        g.bindVertexArray(this.vao);
        this.buffers?.forEach(b => g.deleteBuffer(b));
        this.buffers = [];
        for (const [i, data] of [mesh.positions, mesh.normals, mesh.uvs].entries()) {
            const b = g.createBuffer();
            this.buffers.push(b);
            g.bindBuffer(g.ARRAY_BUFFER, b);
            g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
            g.enableVertexAttribArray(i);
            g.vertexAttribPointer(i, i === 2 ? 2 : 3, g.FLOAT, false, 0, 0);
        }
        const b = g.createBuffer();
        this.buffers.push(b);
        g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b);
        g.bufferData(g.ELEMENT_ARRAY_BUFFER, mesh.indices, g.STATIC_DRAW);
        this.count = mesh.indices.length;
    }
    setMaps(maps) {
        this.maps = maps;
        const g = this.gl;
        for (const [i, key] of ['color', 'aux', 'normal'].entries()) {
            g.activeTexture(g.TEXTURE0 + i);
            g.bindTexture(g.TEXTURE_2D, this.textures[i]);
            g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, maps.resolution, maps.resolution, 0, g.RGBA, g.UNSIGNED_BYTE, maps[key]);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
        }
    }
    render(camera) {
        const g = this.gl, r = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, r.width * dpr);
        this.canvas.height = Math.max(1, r.height * dpr);
        g.viewport(0, 0, this.canvas.width, this.canvas.height);
        g.clearColor(.11, .14, .135, 1);
        g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
        g.enable(g.DEPTH_TEST);
        g.useProgram(this.program);
        g.uniformMatrix4fv(g.getUniformLocation(this.program, 'mvp'), false, camera.matrix(this.canvas.width / this.canvas.height));
        g.uniform3fv(g.getUniformLocation(this.program, 'eye'), camera.eye);
        g.uniform1f(g.getUniformLocation(this.program, 'exposure'), this.exposure);
        g.uniform1i(g.getUniformLocation(this.program, 'channel'), this.channel);
        g.bindVertexArray(this.vao);
        g.drawElements(g.TRIANGLES, this.count, g.UNSIGNED_INT, 0);
        this.frames++;
    }
    renderUV(canvas, zoom = 1) {
        if (!this.maps)
            return;
        const N = this.maps.resolution, raw = this.channel === 4 ? this.maps.normal : this.maps.color;
        let data = raw;
        if ([2, 3, 5, 6].includes(this.channel)) {
            const c = ({ 2: 1, 3: 0, 5: 2, 6: 3 })[this.channel];
            data = new Uint8ClampedArray(N * N * 4);
            for (let i = 0; i < data.length; i += 4)
                data.set([this.maps.aux[i + c], this.maps.aux[i + c], this.maps.aux[i + c], 255], i);
        }
        const temp = new OffscreenCanvas(N, N);
        temp.getContext('2d').putImageData(new ImageData(data, N, N), 0, 0);
        const r = canvas.getBoundingClientRect();
        canvas.width = r.width;
        canvas.height = r.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#202625';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(temp, (1 - zoom) * canvas.width / 2, (1 - zoom) * canvas.height / 2, canvas.width * zoom, canvas.height * zoom);
    }
    dispose() {
        this.buffers?.forEach(b => this.gl.deleteBuffer(b));
        this.textures?.forEach(t => this.gl.deleteTexture(t));
        this.gl.deleteProgram(this.program);
        this.gl.deleteVertexArray(this.vao);
    }
}
export { SoftwareRenderer } from './software.js';
