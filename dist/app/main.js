import { OrbitCamera, BVH } from '@patina/math';
import { primitives, parseOBJ, exportOBJ, serializeMesh, deserializeMesh } from '@patina/mesh';
import { presets, brushes, materialById, drawMaterialPreview, rgbToHex } from '@patina/materials';
import { createProject, newLayer, History, ProjectStore, validateProject, uuid } from '@patina/project';
import { GPUContext } from '@patina/gpu';
import { GPUPaintEngine, CPUPaintEngine, StrokeSampler } from '@patina/paint';
import { GPURenderer, GLRenderer, SoftwareRenderer } from '@patina/renderer';
import { rasterizeGeometry, dilateMaps, BakeWorker } from '@patina/baker';
import { parseGLB, exportGLB, exportTextureBundle, download, encodePNG } from '@patina/io';
import { icon, $, toast, modal, CommandRegistry, installSplitter, escapeHTML } from '@patina/ui';
import { shell, layerHTML, slider } from './views.js';
const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
const base64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192)
        s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
};
const unbase64 = s => Uint8ClampedArray.from(atob(s), c => c.charCodeAt(0));
const prettySize = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
export class Studio {
    constructor() {
        this.project = createProject();
        this.history = new History();
        this.store = new ProjectStore();
        this.camera = new OrbitCamera();
        this.baker = new BakeWorker();
        this.commands = new CommandRegistry();
        this.tool = 'brush';
        this.maskEditing = false;
        this.maskBlack = false;
        this.symmetry = false;
        this.uvWire = true;
        this.assetsTab = 'Materials';
        this.category = 'All';
        this.lastAsset = 'patina';
        this.brushId = 'round';
        this.brush = { radius: 19 / 1024, color: '#d6bc82', metallic: .8, roughness: .37, height: .515, hardness: .3, flow: .65, spacing: .16, shape: 0, pressureSize: true, pressureOpacity: true };
        this.dirty = false;
        this.ready = false;
        this.stroke = null;
        this.pendingPaint = [];
        this.turntable = false;
        this.lastFrame = 0;
        this.syncRequested = false;
        this.syncRunning = false;
        this.editOpen = false;
        this.bakeMaps = null;
        this.currentView = 'split';
        this.cameraView = 0;
        this.events = new AbortController();
    }
    async init() {
        document.getElementById('app').innerHTML = shell();
        document.body.dataset.view = 'split';
        this.setBusy(true, 'Initializing the material engine…');
        let recovered = null;
        try {
            recovered = await this.store.load();
        }
        catch (e) {
            console.warn('Local recovery:', e.message);
        }
        if (recovered)
            this.project = recovered;
        else
            this.makeDemo();
        await this.initBackend();
        if (!this.gpu && !recovered)
            this.project.resolution = 512;
        this.brush.radius = 19 / this.project.resolution;
        await this.rebuild();
        this.bindUI();
        this.renderAll();
        this.ready = true;
        this.setBusy(false);
        this.requestRender();
        window.__PATINA_READY = true;
        this.setStatus(recovered ? 'Recovered your local project.' : 'Ready. Paint the model or explore the material library.');
        if (recovered)
            toast('Recovered your last local workspace.');
        await this.autosave();
    }
    makeDemo() {
        const p = this.project = createProject();
        const copper = newLayer('fill', materialById('copper'), '01  /  Copper foundation');
        const patina = newLayer('fill', materialById('patina'), '02  /  Mineral oxidation');
        patina.generator = 'oxidation';
        patina.generatorAmount = .365;
        patina.material.scale = 9;
        patina.material.detail = .48;
        const edge = newLayer('fill', materialById('brass'), '03  /  Exposed metal');
        edge.generator = 'edge';
        edge.generatorAmount = .28;
        edge.opacity = .72;
        const type = newLayer('paint', null, '04  /  Studio signature');
        type.image = this.signature();
        type.opacity = .83;
        const paint = newLayer('paint', null, '05  /  Hand-painted finish');
        p.layers = [copper, patina, edge, type, paint];
        p.selectedLayer = paint.id;
    }
    signature() {
        const c = document.createElement('canvas');
        c.width = c.height = 1024;
        const x = c.getContext('2d');
        x.translate(848, 375);
        x.fillStyle = '#ded5b5';
        x.textAlign = 'center';
        x.font = '600 46px Arial';
        x.fillText('07', 0, 0);
        x.font = '8px Arial';
        x.fillText('P A T I N A', 0, 17);
        x.globalAlpha = .8;
        x.fillRect(-31, -58, 62, 2);
        x.fillRect(-31, 26, 62, 1);
        for (let i = 0; i < 7; i++)
            x.fillRect(-29 + i * 9, 33, 3, i === 0 || i === 6 ? 9 : 5);
        return c.toDataURL('image/png');
    }
    async initBackend(forceCPU = false) {
        this.gpu = null;
        const force = forceCPU || new URLSearchParams(location.search).get('backend') === 'cpu';
        let canvas = $('#scene');
        if (!force) {
            try {
                this.gpu = await GPUContext.create();
                this.renderer = await new GPURenderer(canvas, this.gpu).init();
                this.gpu.onError = e => this.setStatus('GPU validation: ' + e.message, true);
                this.gpu.onLost = () => this.recoverDevice();
            }
            catch (e) {
                console.warn('WebGPU initialization:', e);
                this.gpu?.destroy();
                this.gpu = null;
                const clone = canvas.cloneNode();
                canvas.replaceWith(clone);
                canvas = clone;
            }
        }
        if (!this.gpu) {
            try {
                this.renderer = await new GLRenderer(canvas).init();
            }
            catch (e) {
                console.warn('WebGL2 unavailable; using software rasterizer.');
                const clone = canvas.cloneNode();
                canvas.replaceWith(clone);
                canvas = clone;
                this.renderer = await new SoftwareRenderer(canvas).init();
            }
        }
        const backend = this.gpu ? 'WebGPU' : this.renderer.software ? 'Software + CPU' : 'WebGL2 + CPU';
        $('#backend').textContent = this.gpu ? 'WEBGPU COMPUTE' : 'COMPATIBILITY MODE';
        $('#status-backend').textContent = backend;
        $('#render-label').textContent = this.gpu ? 'Real-time PBR · WebGPU' : this.renderer.software ? 'Software preview · CPU painting' : 'PBR preview · CPU painting';
        if (!this.gpu) {
            $('#wireframe').disabled = true;
            $('#environment').disabled = true;
            $('#wireframe').title = 'Wireframe overlay requires WebGPU';
            $('#environment').title = 'Environment presets require WebGPU';
        }
        return backend;
    }
    async recoverDevice() {
        if (this.recovering)
            return;
        this.recovering = true;
        try {
            this.finishStroke();
            this.setBusy(true, 'Recovering your workspace in compatibility mode…');
            await this.autosave();
            this.engine?.dispose();
            this.renderer?.dispose();
            this.gpu?.destroy();
            for (const id of ['scene', 'uv-canvas']) {
                const node = $('#' + id);
                node.replaceWith(node.cloneNode());
            }
            await this.initBackend(true);
            await this.rebuild();
            this.bindViewport();
            this.setBusy(false);
            toast('GPU device lost. Your project was recovered using the CPU backend.');
        }
        catch (e) {
            this.error(e);
            this.setBusy(false);
        }
        finally {
            this.recovering = false;
        }
    }
    setBusy(on, message = 'Updating workspace…') {
        const el = $('#busy-overlay');
        if (el)
            el.classList.toggle('visible', on);
        if ($('#busy-message'))
            $('#busy-message').textContent = message;
    }
    setStatus(message, error = false) {
        const el = $('#status-action');
        if (el) {
            el.textContent = message;
            el.style.color = error ? '#e0a97a' : '';
        }
    }
    error(e) {
        if (e?.name === 'AbortError')
            return;
        console.error(e);
        toast(e?.message || String(e), 'error');
        this.setStatus(e?.message || String(e), true);
    }
    guard(fn) {
        return (...args) => Promise.resolve().then(() => fn(...args)).catch(e => this.error(e));
    }
    get selected() {
        return this.project.layers.find(l => l.id === this.project.selectedLayer) || this.project.layers.at(-1);
    }
    checkBudget(count = this.project.layers.length, res = this.project.resolution) {
        const bytes = (count * 6 + 10) * res * res * 4;
        if (count > 24)
            throw Error('This project already has the maximum of 24 layers.');
        if (bytes > 768 * 1024 * 1024)
            throw Error('The estimated texture allocation exceeds 768 MiB. Reduce the resolution or layer count.');
    }
    async rebuild() {
        this.checkBudget();
        this.engine?.dispose();
        this.engine = await new (this.gpu ? GPUPaintEngine : CPUPaintEngine)(this.gpu, this.project.resolution).init();
        this.mesh = this.project.mesh.primitive ? primitives[this.project.mesh.primitive]?.() : deserializeMesh(this.project.mesh.data);
        if (!this.mesh)
            throw Error('Unknown mesh preset.');
        this.bvh = new BVH(this.mesh);
        this.renderer.setMesh(this.mesh);
        if (this.project.bake) {
            const b = this.project.bake;
            this.bakeMaps = { resolution: b.resolution, geometry: unbase64(b.geometry), surface: unbase64(b.surface) };
        }
        else
            this.bakeMaps = dilateMaps(rasterizeGeometry(this.mesh, 256), 4);
        this.engine.setGeometry(this.bakeMaps);
        await this.engine.sync(this.project);
        this.renderer.setMaps(this.engine.composite(this.project));
        this.renderMetadata();
        this.dirty = true;
    }
    async sync() {
        if (this.stroke)
            return;
        this.syncRequested = true;
        if (this.syncRunning)
            return this.syncPromise;
        this.syncRunning = true;
        this.syncPromise = (async () => {
            try {
                while (this.syncRequested) {
                    this.syncRequested = false;
                    const start = performance.now();
                    await this.engine.sync(this.project);
                    this.renderer.setMaps(this.engine.composite(this.project));
                    this.lastCompositeMS = performance.now() - start;
                    this.requestRender();
                }
            }
            finally {
                this.syncRunning = false;
            }
        })();
        return this.syncPromise;
    }
    scheduleSync() {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.sync().catch(e => this.error(e)), this.gpu ? 25 : 160);
        this.changed();
    }
    checkpoint(label) {
        this.history.push(this.project, label);
    }
    changed() {
        this.project.updatedAt = new Date().toISOString();
        $('#save-state').innerHTML = '<i></i>Unsaved changes';
        $('#save-state').classList.add('dirty-state');
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.autosave(), 900);
        this.renderHistoryButtons();
    }
    async autosave() {
        try {
            await this.store.save(this.project);
            $('#save-state').innerHTML = icon('check', 11) + 'Saved on device';
            $('#save-state').classList.remove('dirty-state');
            return true;
        }
        catch (e) {
            $('#save-state').textContent = 'Local save unavailable';
            this.setStatus('Local storage failed. Use Project → Save project to keep your work.', true);
            console.warn(e);
            return false;
        }
    }
    async mutate(label, fn, { rebuild = false } = {}) {
        clearTimeout(this.syncTimer);
        if (this.stroke)
            this.finishStroke();
        await this.syncPromise;
        this.checkpoint(label);
        try {
            await fn();
            if (rebuild)
                await this.rebuild();
            else
                await this.sync();
            this.changed();
            this.renderAll();
        }
        catch (e) {
            const previous = this.history.undo(this.project);
            if (previous) {
                this.project = previous.project;
                await this.rebuild();
                this.renderAll();
            }
            throw e;
        }
    }
    async undo(redo = false) {
        clearTimeout(this.syncTimer);
        if (this.stroke)
            this.finishStroke();
        await this.syncPromise;
        const change = redo ? this.history.redo(this.project) : this.history.undo(this.project);
        if (!change)
            return;
        this.project = validateProject(change.project);
        this.setBusy(true, `${redo ? 'Redoing' : 'Undoing'} ${change.label.toLowerCase()}…`);
        try {
            await this.rebuild();
            this.renderAll();
            this.changed();
            this.requestRender();
            this.setStatus(`${redo ? 'Redid' : 'Undid'}: ${change.label}`);
        }
        finally {
            this.setBusy(false);
        }
    }
    requestRender() {
        this.dirty = true;
        if (this.framePending)
            return;
        this.framePending = true;
        requestAnimationFrame(t => this.frame(t));
    }
    frame(time) {
        this.framePending = false;
        if (!this.renderer || !this.engine)
            return;
        const dt = this.lastFrame ? Math.min(.05, (time - this.lastFrame) / 1000) : 0;
        this.lastFrame = time;
        if (this.turntable) {
            this.camera.yaw += dt * .23;
            this.dirty = true;
        }
        if (this.pendingPaint.length) {
            const queued = this.pendingPaint.splice(0);
            for (const { id, stroke, points } of queued)
                this.engine.paint(id, stroke, points);
            this.renderer.setMaps(this.engine.composite(this.project));
            this.dirty = true;
        }
        if (this.dirty) {
            const start = performance.now();
            this.renderer.render(this.camera);
            if (this.currentView !== '3d' && $('#uv-pane').getBoundingClientRect().width > 0)
                this.renderer.renderUV($('#uv-canvas'));
            this.drawUVWire();
            this.lastRenderMS = performance.now() - start;
            $('#status-render').textContent = `${this.gpu ? 'GPU' : 'CPU'} submit ${this.lastRenderMS.toFixed(1)} ms`;
            this.dirty = false;
        }
        if (this.turntable || this.pendingPaint.length)
            this.requestRender();
    }
    drawUVWire() {
        const canvas = $('#uv-wire-canvas'), r = canvas.getBoundingClientRect();
        if (!r.width)
            return;
        const dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!this.uvWire)
            return;
        ctx.strokeStyle = 'rgba(218,232,181,.16)';
        ctx.lineWidth = .45 * dpr;
        const { uvs: uv, indices: idx } = this.mesh;
        ctx.beginPath();
        for (let i = 0; i < idx.length; i += 3) {
            const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
            ctx.moveTo(uv[a] * canvas.width, uv[a + 1] * canvas.height);
            ctx.lineTo(uv[b] * canvas.width, uv[b + 1] * canvas.height);
            ctx.lineTo(uv[c] * canvas.width, uv[c + 1] * canvas.height);
            ctx.closePath();
        }
        ctx.stroke();
    }
    renderMetadata() {
        const p = this.project;
        $('#project-name').textContent = p.name;
        $('#breadcrumb-name').textContent = p.name;
        document.title = p.name + ' — PatinaStudio';
        $('#mesh-stats').textContent = `${prettySize(this.mesh.indices.length / 3)} triangles`;
        $('#status-size').textContent = `${p.resolution}² · ${p.layers.length} layers`;
        $('#resolution').value = p.resolution;
        const demo = p.mesh.primitive === 'artifact';
        $('#scene-title').innerHTML = demo ? 'A little time.<br>A lot of character.' : escapeHTML(this.mesh.name || p.name);
        $('#scene-caption').textContent = demo ? 'Oxidized copper · brushed brass · human touch' : 'Material painting · UV workspace';
        $('#bake-state').textContent = p.bake ? 'Mesh maps baked' : 'Geometry maps ready';
        $('#bake-description').textContent = p.bake ? `AO · curvature · ${p.bake.resolution} px` : 'Normals · position · curvature';
    }
    renderAll() {
        this.renderMetadata();
        this.renderLayers();
        this.renderProperties();
        this.renderAssets();
        this.renderHistoryButtons();
        this.requestRender();
    }
    renderHistoryButtons() {
        $('#undo').disabled = !this.history.past.length;
        $('#redo').disabled = !this.history.future.length;
    }
    renderLayers() {
        const selected = this.selected;
        $('#layer-list').innerHTML = [...this.project.layers].reverse().map(l => layerHTML(l, l.id === selected?.id, this.maskEditing)).join('');
        $('#layer-count').textContent = this.project.layers.length;
        $('#blend-mode').value = selected?.blend || 'normal';
        $('#layer-opacity').value = Math.round((selected?.opacity ?? 1) * 100);
        $('#opacity-value').textContent = $('#layer-opacity').value;
        $('#layer-hint').textContent = this.maskEditing ? 'Painting the layer mask' : 'Non-destructive layer stack';
        $('#mask-tool').classList.toggle('active', this.maskEditing);
        $('#mask-tool').setAttribute('aria-pressed', String(this.maskEditing));
        $('#delete-layer').disabled = !selected;
    }
    renderProperties() {
        const l = this.selected;
        $('#property-kind').textContent = l ? this.maskEditing ? 'MASK' : l.type.toUpperCase() : 'NONE';
        if (!l) {
            $('#properties').innerHTML = '<p class="property-note">Add a paint or fill layer to start.</p>';
            return;
        }
        const m = l.type === 'fill' ? l.material : this.brush;
        $('#properties').innerHTML = `<div class="property-title">${icon(this.maskEditing ? 'mask' : l.type === 'fill' ? 'drop' : 'brush', 16)}${this.maskEditing ? 'Layer mask' : l.type === 'fill' ? 'Fill material' : 'Paint brush'}<small>${this.maskEditing ? 'GRAYSCALE' : l.type === 'fill' ? 'PROCEDURAL' : 'PBR CHANNELS'}</small></div><div class="channel-toggles">${['Color', 'Metal', 'Rough', 'Height'].map((c, i) => `<label><input type="checkbox" data-channel="${i}" ${l.channels[i] ? 'checked' : ''}>${c}</label>`).join('')}</div>${this.maskEditing ? `<div class="property-section"><h3>Mask painting</h3><p class="property-note">White reveals this layer. Black hides it. Painted masks multiply the procedural generator.</p><div class="mask-controls"><button id="mask-white" class="${!this.maskBlack ? 'active' : ''}">Paint white</button><button id="mask-black" class="${this.maskBlack ? 'active' : ''}">Paint black</button></div><div class="mask-controls"><button id="mask-clear-white">Fill white</button><button id="mask-clear-black">Fill black</button></div></div>` : ''}<div class="property-section"><h3>${l.type === 'fill' ? 'Material channels' : 'Brush channels'}</h3><div class="property-row"><span>Base color</span><span class="color-hex" id="color-value">${m.color.toUpperCase()}</span><input id="property-color" type="color" value="${m.color}" aria-label="${l.type === 'fill' ? 'Material' : 'Brush'} base color"></div>${l.type === 'fill' ? `<div class="property-row"><span>Secondary color</span><input id="secondary-color" type="color" value="${m.secondary}" aria-label="Material secondary color"></div>` : ''}${slider('property-metal', 'Metallic', m.metallic, 0, 1, .01)}${slider('property-rough', 'Roughness', m.roughness, .04, 1, .01)}${slider('property-height', 'Height', m.height, 0, 1, .005)}${l.type === 'fill' ? `${slider('property-scale', 'Texture scale', m.scale, 1, 30, .5)}${slider('property-detail', 'Microstructure', m.detail, 0, 1, .01)}` : `${slider('property-spacing', 'Stroke spacing', this.brush.spacing, .05, .8, .01)}<div class="property-row"><span>Brush shape</span><select id="property-shape" aria-label="Brush shape">${brushes.map(b => `<option value="${b.id}" ${b.id === this.brushId ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>`}</div><div class="property-section"><h3>Procedural mask</h3><div class="property-row"><span>Generator</span><select id="generator" aria-label="Layer generator">${[['none', 'None'], ['edge', 'Curvature / edges'], ['cavity', 'Cavities'], ['oxidation', 'Oxidation'], ['dirt', 'AO / dirt'], ['noise', 'Fractal noise']].map(([v, t]) => `<option value="${v}" ${l.generator === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>${l.generator !== 'none' ? slider('generator-amount', 'Threshold', l.generatorAmount, 0, 1, .01) : ''}<div class="property-row"><span>Painted mask</span><label><input id="mask-enabled" type="checkbox" ${l.mask?.enabled ? 'checked' : ''}>Enabled</label></div><p class="property-note">${l.generator === 'dirt' && !this.project.bake ? 'Bake ambient occlusion to make the dirt generator respond to occluded geometry.' : l.type === 'fill' ? 'Material parameters remain editable. Add a paint layer for freehand strokes.' : 'Paint in either viewport. All four material channels are recorded in each stroke.'}</p></div>`;
        const color = $('#property-color');
        this.bindProperty(color, () => m.color, v => {
            m.color = v;
            $('#color-value').textContent = v.toUpperCase();
            if (l.type === 'paint')
                $('#rail-color').value = v;
        }, l.type === 'fill');
        if (l.type === 'fill')
            this.bindProperty($('#secondary-color'), () => m.secondary, v => m.secondary = v, true);
        for (const [id, key] of [['property-metal', 'metallic'], ['property-rough', 'roughness'], ['property-height', 'height'], ['property-scale', 'scale'], ['property-detail', 'detail'], ['property-spacing', 'spacing']]) {
            const el = $('#' + id);
            if (!el)
                continue;
            this.bindProperty(el, () => m[key], v => {
                if (key === 'spacing')
                    this.brush.spacing = +v;
                else
                    m[key] = +v;
                $('#' + id + '-value').textContent = v;
            }, l.type === 'fill');
        }
        $('#property-shape')?.addEventListener('change', e => this.applyBrush(e.target.value));
        $('#generator').onchange = this.guard(async (e) => {
            await this.mutate('Change generator', () => {
                l.generator = e.target.value;
            });
        });
        $('#mask-enabled').onchange = this.guard(async (e) => {
            await this.mutate('Toggle mask', () => {
                l.mask.enabled = e.target.checked;
                if (!l.mask.enabled)
                    this.maskEditing = false;
            });
        });
        if ($('#generator-amount'))
            this.bindProperty($('#generator-amount'), () => l.generatorAmount, v => {
                l.generatorAmount = +v;
                $('#generator-amount-value').textContent = v;
            }, true);
        for (const input of document.querySelectorAll('[data-channel]'))
            input.onchange = this.guard(async (e) => {
                await this.mutate('Toggle material channel', () => {
                    l.channels[+input.dataset.channel] = e.target.checked;
                });
            });
        if (this.maskEditing) {
            $('#mask-white').onclick = () => {
                this.maskBlack = false;
                this.renderProperties();
            };
            $('#mask-black').onclick = () => {
                this.maskBlack = true;
                this.renderProperties();
            };
            for (const [id, base] of [['mask-clear-white', 1], ['mask-clear-black', 0]])
                $('#' + id).onclick = this.guard(() => this.mutate('Fill layer mask', () => {
                    l.mask.base = base;
                    l.mask.strokes = [];
                }));
        }
    }
    bindProperty(el, get, set, semantic) {
        if (!el)
            return;
        let opened = false;
        el.addEventListener('input', () => {
            if (semantic && !opened) {
                this.checkpoint('Adjust ' + el.getAttribute('aria-label'));
                opened = true;
            }
            set(el.value);
            if (semantic)
                this.scheduleSync();
        });
        el.addEventListener('change', () => {
            opened = false;
            if (semantic) {
                this.changed();
                this.renderLayers();
            }
        });
    }
    renderAssets() {
        const grid = $('#asset-grid'), search = $('#asset-search').value.toLowerCase();
        grid.replaceChildren();
        $('#asset-categories').style.display = this.assetsTab === 'Materials' ? '' : 'none';
        if (this.assetsTab === 'Materials') {
            for (const m of presets) {
                if ((this.category !== 'All' && m.category !== this.category) || !m.name.toLowerCase().includes(search))
                    continue;
                const b = document.createElement('button');
                b.className = 'asset-tile' + (m.id === this.lastAsset ? ' selected' : '');
                b.title = m.description + ' — click to apply';
                b.innerHTML = `<div class="asset-preview"><canvas></canvas></div><b>${escapeHTML(m.name)}</b><small>${m.category.toUpperCase()}</small>`;
                drawMaterialPreview($('canvas', b), m);
                b.onclick = this.guard(() => this.applyMaterial(m.id));
                grid.append(b);
            }
        }
        else if (this.assetsTab === 'Brushes') {
            for (const brush of brushes) {
                if (!brush.name.toLowerCase().includes(search))
                    continue;
                const b = document.createElement('button');
                b.className = 'asset-tile' + (brush.id === this.brushId ? ' selected' : '');
                b.innerHTML = `<div class="asset-preview"><canvas></canvas></div><b>${brush.name}</b><small>PAINT BRUSH</small>`;
                const c = $('canvas', b);
                c.width = c.height = 100;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#d2e6ba';
                for (let i = 0; i < 18; i++) {
                    const x = 20 + i * 3.5, y = 55 + Math.sin(i * .25) * 12, r = 6 + i * .25;
                    ctx.globalAlpha = brush.shape === 2 ? .3 : .65;
                    if (brush.shape === 4)
                        ctx.fillRect(x - r, y - r, r * 2, r * 2);
                    else if (brush.shape === 3)
                        ctx.fillRect(x - r, y - r / 4, r * 2, r / 2);
                    else {
                        ctx.beginPath();
                        ctx.arc(x, y, r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                b.onclick = () => this.applyBrush(brush.id);
                grid.append(b);
            }
        }
        else if (this.assetsTab === 'Meshes') {
            for (const [id, label] of [['artifact', 'Artifact 07'], ['sphere', 'Shader sphere'], ['torus', 'Torus'], ['cube', 'UV cube']]) {
                if (!label.toLowerCase().includes(search))
                    continue;
                const b = document.createElement('button');
                b.className = 'asset-tile' + (this.project.mesh.primitive === id ? ' selected' : '');
                b.innerHTML = `<div class="asset-preview">${icon(id === 'cube' ? 'cube' : id === 'artifact' ? 'sun' : id === 'torus' ? 'rotate' : 'drop', 47)}</div><b>${label}</b><small>UV-MAPPED MESH</small>`;
                b.onclick = this.guard(() => this.switchMesh(id));
                grid.append(b);
            }
        }
        else {
            for (const [i, entry] of [...this.history.past].reverse().entries()) {
                const el = document.createElement('div');
                el.className = 'history-entry';
                el.innerHTML = `<span class="mini-overline">EDIT ${this.history.past.length - i}</span><span>${escapeHTML(entry.label)}</span>`;
                grid.append(el);
            }
        }
        if (!grid.children.length)
            grid.innerHTML = '<p class="asset-empty">' + (this.assetsTab === 'History' ? 'Your next edits will appear here.' : 'No matching assets.') + '</p>';
    }
    async applyMaterial(id) {
        const material = materialById(id);
        this.lastAsset = id;
        await this.mutate('Apply ' + material.name, () => {
            const l = this.selected;
            if (l?.type === 'fill') {
                l.material = material;
                l.name = material.name;
            }
            else {
                this.checkBudget(this.project.layers.length + 1);
                const fill = newLayer('fill', material, material.name);
                this.project.layers.push(fill);
                this.project.selectedLayer = fill.id;
            }
            this.maskEditing = false;
        });
        toast(material.name + ' applied as an editable fill layer.');
    }
    applyBrush(id) {
        const b = brushes.find(b => b.id === id) || brushes[0];
        this.brushId = b.id;
        this.brush.hardness = b.hardness;
        this.brush.spacing = b.spacing;
        this.brush.shape = b.shape;
        $('#brush-name').textContent = b.name;
        $('#brush-hardness').value = b.hardness * 100;
        $('#hardness-value').textContent = Math.round(b.hardness * 100);
        this.setTool('brush');
        this.renderProperties();
        this.renderAssets();
    }
    async addLayer(type = 'paint') {
        this.checkBudget(this.project.layers.length + 1);
        await this.mutate('Add ' + type + ' layer', () => {
            const l = newLayer(type, type === 'fill' ? materialById(this.lastAsset) : null, type === 'paint' ? 'Paint layer ' + String(this.project.layers.filter(x => x.type === 'paint').length + 1).padStart(2, '0') : undefined);
            this.project.layers.push(l);
            this.project.selectedLayer = l.id;
            this.maskEditing = false;
        });
        if (type === 'paint')
            this.setTool('brush');
    }
    async switchMesh(primitive) {
        this.setBusy(true, 'Building mesh and UV maps…');
        try {
            await this.mutate('Switch mesh', () => {
                this.project.mesh = { primitive };
                delete this.project.bake;
                this.camera.reset();
            }, { rebuild: true });
            toast('Switched to ' + this.mesh.name + '. Existing layers are preserved.');
        }
        finally {
            this.setBusy(false);
        }
    }
    setTool(tool) {
        this.tool = tool;
        for (const b of document.querySelectorAll('[data-tool]')) {
            b.classList.toggle('active', b.dataset.tool === tool);
            b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
        }
        $('#scene').style.cursor = tool === 'orbit' ? 'grab' : tool === 'picker' ? 'copy' : 'crosshair';
        this.setStatus(({ brush: 'Brush · drag to paint. Alt-drag to orbit.', eraser: 'Eraser · removes paint coverage, revealing lower layers.', picker: 'Color picker · click the model or UV texture.', orbit: 'Navigation · drag to orbit. Shift-drag to pan.' })[tool]);
    }
    bindUI() {
        const on = (id, fn) => $('#' + id).onclick = this.guard(fn);
        on('add-paint', () => this.addLayer());
        for (const id of ['add-fill', 'add-fill-tool'])
            on(id, () => this.addLayer('fill'));
        on('undo', () => this.undo());
        on('redo', () => this.undo(true));
        on('project-title', () => this.renameProject());
        on('project-menu', () => this.projectMenu());
        on('edit-menu', () => this.editMenu());
        on('view-menu', () => this.viewMenu());
        on('command', () => this.commands.palette());
        on('help', () => this.help());
        on('settings', () => this.settings());
        on('export', () => this.exportDialog());
        on('bake', () => this.bakeDialog());
        on('bake-small', () => this.bakeDialog());
        on('import-mesh', () => $('#mesh-file').click());
        on('import-decal', () => $('#decal-file').click());
        on('text-decal', () => this.textDecal());
        on('brush-preset', () => this.setAssets('Brushes'));
        on('symmetry', () => {
            this.symmetry = !this.symmetry;
            $('#symmetry').classList.toggle('active', this.symmetry);
            $('#symmetry').setAttribute('aria-pressed', String(this.symmetry));
            this.setStatus('World-X symmetry ' + (this.symmetry ? 'enabled' : 'disabled') + '.');
        });
        on('add-mask', () => this.toggleMask());
        on('mask-tool', () => this.toggleMaskEditing());
        on('duplicate-layer', () => this.mutate('Duplicate layer', () => {
            this.checkBudget(this.project.layers.length + 1);
            const copy = structuredClone(this.selected);
            copy.id = uuid();
            copy.name += ' copy';
            this.project.layers.splice(this.project.layers.indexOf(this.selected) + 1, 0, copy);
            this.project.selectedLayer = copy.id;
        }));
        on('delete-layer', () => this.mutate('Delete layer', () => {
            const i = this.project.layers.indexOf(this.selected);
            this.project.layers.splice(i, 1);
            this.project.selectedLayer = this.project.layers[Math.max(0, i - 1)]?.id || null;
            this.maskEditing = false;
        }));
        on('move-layer-up', () => this.moveLayer(1));
        on('move-layer-down', () => this.moveLayer(-1));
        $('#layer-list').addEventListener('click', this.guard(async (e) => {
            const visibility = e.target.closest('[data-visibility]');
            if (visibility) {
                await this.mutate('Toggle layer visibility', () => {
                    const l = this.project.layers.find(l => l.id === visibility.dataset.visibility);
                    l.visible = !l.visible;
                });
                return;
            }
            const row = e.target.closest('[data-layer]');
            if (!row)
                return;
            this.project.selectedLayer = row.dataset.layer;
            this.maskEditing = !!e.target.closest('[data-mask]');
            this.renderLayers();
            this.renderProperties();
        }));
        $('#layer-list').addEventListener('dblclick', e => {
            const row = e.target.closest('[data-layer]');
            if (row)
                this.renameLayer(row.dataset.layer);
        });
        $('#layer-list').addEventListener('dragstart', e => {
            const row = e.target.closest('[data-layer]');
            if (row)
                e.dataTransfer.setData('application/patina-layer', row.dataset.layer);
        });
        $('#layer-list').addEventListener('dragover', e => {
            if (e.dataTransfer.types.includes('application/patina-layer'))
                e.preventDefault();
        });
        $('#layer-list').addEventListener('drop', this.guard(async (e) => {
            const id = e.dataTransfer.getData('application/patina-layer'), target = e.target.closest('[data-layer]');
            if (!id || !target)
                return;
            e.preventDefault();
            await this.mutate('Reorder layers', () => {
                const layer = this.project.layers.find(l => l.id === id);
                if (!layer)
                    return;
                this.project.layers.splice(this.project.layers.indexOf(layer), 1);
                const at = this.project.layers.findIndex(l => l.id === target.dataset.layer);
                this.project.layers.splice(Math.max(0, at), 0, layer);
            });
        }));
        $('#blend-mode').onchange = this.guard(e => this.mutate('Change blend mode', () => {
            if (this.selected)
                this.selected.blend = e.target.value;
        }));
        let opacityEdit = false;
        $('#layer-opacity').oninput = e => {
            if (!this.selected)
                return;
            if (!opacityEdit) {
                this.checkpoint('Adjust layer opacity');
                opacityEdit = true;
            }
            this.selected.opacity = +e.target.value / 100;
            $('#opacity-value').textContent = e.target.value;
            this.scheduleSync();
        };
        $('#layer-opacity').onchange = () => {
            opacityEdit = false;
            this.renderLayers();
        };
        $('#brush-size').oninput = e => {
            this.brush.radius = +e.target.value / 2 / this.project.resolution;
            $('#size-value').textContent = e.target.value;
        };
        $('#brush-flow').oninput = e => {
            this.brush.flow = +e.target.value / 100;
            $('#flow-value').textContent = e.target.value;
        };
        $('#brush-hardness').oninput = e => {
            this.brush.hardness = +e.target.value / 100;
            $('#hardness-value').textContent = e.target.value;
        };
        $('#pressure').onchange = e => {
            this.brush.pressureSize = this.brush.pressureOpacity = e.target.checked;
        };
        $('#rail-color').oninput = e => {
            this.brush.color = e.target.value;
            if (this.selected?.type === 'paint')
                this.renderProperties();
        };
        for (const b of document.querySelectorAll('[data-tool]'))
            b.onclick = () => this.setTool(b.dataset.tool);
        for (const b of document.querySelectorAll('[data-view]'))
            b.onclick = () => this.setView(b.dataset.view);
        for (const b of document.querySelectorAll('[data-assets]'))
            b.onclick = () => this.setAssets(b.dataset.assets);
        for (const b of document.querySelectorAll('[data-category]'))
            b.onclick = () => {
                this.category = b.dataset.category;
                document.querySelectorAll('[data-category]').forEach(n => n.classList.toggle('active', n === b));
                this.renderAssets();
            };
        $('#asset-search').oninput = () => this.renderAssets();
        $('#channel').onchange = e => {
            this.renderer.channel = +e.target.value;
            this.requestRender();
        };
        $('#environment').onchange = e => {
            this.renderer.environment = +e.target.value;
            this.requestRender();
        };
        on('wireframe', () => {
            this.renderer.wireframe = !this.renderer.wireframe;
            $('#wireframe').classList.toggle('active', this.renderer.wireframe);
            this.requestRender();
        });
        on('uv-wire', () => {
            this.uvWire = !this.uvWire;
            $('#uv-wire').classList.toggle('active', this.uvWire);
            this.requestRender();
        });
        on('frame', () => {
            this.camera.reset();
            this.cameraView = 0;
            $('#camera-view').textContent = 'PERSPECTIVE';
            this.requestRender();
        });
        on('turntable', () => {
            this.turntable = !this.turntable;
            $('#turntable').classList.toggle('active', this.turntable);
            this.requestRender();
        });
        on('camera-view', () => {
            this.cameraView = (this.cameraView + 1) % 4;
            this.camera.reset();
            if (this.cameraView === 1) {
                this.camera.yaw = 0;
                this.camera.pitch = 0;
            }
            if (this.cameraView === 2) {
                this.camera.yaw = Math.PI / 2;
                this.camera.pitch = 0;
            }
            if (this.cameraView === 3) {
                this.camera.yaw = 0;
                this.camera.pitch = 1.47;
            }
            $('#camera-view').textContent = ['PERSPECTIVE', 'FRONT', 'RIGHT', 'TOP'][this.cameraView];
            this.requestRender();
        });
        on('screenshot', () => this.screenshot());
        $('#resolution').onchange = this.guard(async (e) => {
            const res = +e.target.value;
            try {
                this.checkBudget(this.project.layers.length, res);
            }
            catch (err) {
                e.target.value = this.project.resolution;
                throw err;
            }
            this.setBusy(true, 'Rebuilding textures at ' + res + ' × ' + res + '…');
            try {
                await this.mutate('Change texture resolution', () => {
                    this.project.resolution = res;
                    this.brush.radius = +$('#brush-size').value / 2 / res;
                }, { rebuild: true });
            }
            finally {
                this.setBusy(false);
            }
        });
        $('#mesh-file').onchange = this.guard(async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (f)
                await this.importMesh(f);
        });
        $('#project-file').onchange = this.guard(async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (f)
                await this.openProject(f);
        });
        $('#decal-file').onchange = this.guard(async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (f)
                await this.imageDecal(f);
        });
        installSplitter($('#inspector-splitter'), { target: $('#workspace'), property: '--inspector-width', min: 220, max: 440, invert: true, storageKey: 'patina-inspector-width' });
        new ResizeObserver(() => this.requestRender()).observe($('#workspace'));
        this.bindViewport();
        this.registerCommands();
        document.addEventListener('keydown', e => this.keyboard(e));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.finishStroke();
                this.autosave();
            }
            else
                this.requestRender();
        });
        window.addEventListener('beforeunload', () => {
            this.finishStroke();
            this.autosave();
        });
    }
    async moveLayer(direction) {
        const l = this.selected, i = this.project.layers.indexOf(l), j = i + direction;
        if (!l || j < 0 || j >= this.project.layers.length)
            return;
        await this.mutate('Move layer', () => {
            [this.project.layers[i], this.project.layers[j]] = [this.project.layers[j], this.project.layers[i]];
        });
    }
    setView(view) {
        this.currentView = view;
        document.body.dataset.view = view;
        for (const b of document.querySelectorAll('[data-view]'))
            b.classList.toggle('active', b.dataset.view === view);
        this.requestRender();
    }
    setAssets(tab) {
        this.assetsTab = tab;
        $('#asset-search').value = '';
        for (const b of document.querySelectorAll('[data-assets]'))
            b.classList.toggle('active', b.dataset.assets === tab);
        this.renderAssets();
    }
    async toggleMask() {
        if (!this.selected)
            return;
        await this.mutate('Toggle painted mask', () => {
            this.selected.mask.enabled = !this.selected.mask.enabled;
            this.maskEditing = this.selected.mask.enabled;
        });
    }
    async toggleMaskEditing() {
        if (!this.selected)
            return;
        if (!this.selected.mask.enabled) {
            await this.mutate('Add painted mask', () => {
                this.selected.mask.enabled = true;
                this.maskEditing = true;
            });
        }
        else {
            this.maskEditing = !this.maskEditing;
            this.renderLayers();
            this.renderProperties();
        }
    }
    bindViewport() {
        for (const canvas of [$('#scene'), $('#uv-canvas')]) {
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            canvas.addEventListener('pointerdown', e => this.pointerDown(e, canvas));
            canvas.addEventListener('pointermove', e => this.pointerMove(e, canvas));
            canvas.addEventListener('pointerup', e => this.pointerUp(e, canvas));
            canvas.addEventListener('pointercancel', e => this.pointerUp(e, canvas));
            canvas.addEventListener('lostpointercapture', () => {
                this.finishStroke();
                this.navigation = null;
            });
            canvas.addEventListener('pointerleave', () => {
                $('#brush-cursor').style.display = 'none';
            });
            canvas.addEventListener('wheel', e => {
                e.preventDefault();
                if (e.ctrlKey || e.shiftKey) {
                    const size = Math.max(2, Math.min(160, +$('#brush-size').value + (e.deltaY > 0 ? -2 : 2)));
                    $('#brush-size').value = size;
                    $('#brush-size').dispatchEvent(new Event('input'));
                }
                else if (canvas.id === 'scene') {
                    this.camera.zoom(e.deltaY);
                    this.requestRender();
                }
            }, { passive: false });
            canvas.addEventListener('dragover', e => {
                e.preventDefault();
                canvas.classList.add('drop-target');
            });
            canvas.addEventListener('dragleave', () => canvas.classList.remove('drop-target'));
            canvas.addEventListener('drop', this.guard(async (e) => {
                e.preventDefault();
                canvas.classList.remove('drop-target');
                const f = e.dataTransfer.files[0];
                if (!f)
                    return;
                if (/\.(obj|glb)$/i.test(f.name))
                    await this.importMesh(f);
                else if (/\.(patina|json)$/i.test(f.name))
                    await this.openProject(f);
                else if (f.type.startsWith('image/'))
                    await this.imageDecal(f);
            }));
        }
    }
    pick(e, canvas) {
        const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (canvas.id === 'uv-canvas')
            return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { uv: [x, y], position: null } : null;
        const ray = this.camera.ray(x * 2 - 1, 1 - y * 2, r.width / r.height);
        const hit = this.bvh.hit(ray.origin, ray.direction);
        if (hit)
            hit.ray = ray;
        return hit;
    }
    pointerDown(e, canvas) {
        if (!this.ready || this.syncRunning)
            return;
        if (this.navigation || this.stroke)
            return;
        e.preventDefault();
        canvas.focus();
        canvas.setPointerCapture(e.pointerId);
        this.turntable = false;
        $('#turntable').classList.remove('active');
        const nav = canvas.id === 'scene' && (e.altKey || e.button === 1 || e.button === 2 || this.tool === 'orbit' || e.shiftKey);
        if (nav) {
            this.navigation = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
            return;
        }
        if (e.button !== 0)
            return;
        const hit = this.pick(e, canvas);
        if (!hit) {
            if (canvas.id === 'scene')
                this.navigation = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: false };
            return;
        }
        if (this.tool === 'picker') {
            this.pickColor(hit.uv).catch(err => this.error(err));
            return;
        }
        const l = this.selected;
        if (!l) {
            toast('Add a paint layer with the + button.');
            return;
        }
        if (l.type === 'fill' && !this.maskEditing) {
            toast('Fill layers are procedural. Add a paint layer (+), or paint this layer’s mask.');
            return;
        }
        this.checkpoint(this.maskEditing ? 'Paint mask' : this.tool === 'eraser' ? 'Erase stroke' : 'Paint stroke');
        const mode = this.maskEditing ? (this.maskBlack || this.tool === 'eraser' ? 3 : 2) : this.tool === 'eraser' ? 1 : 0, stroke = { mode, settings: structuredClone(this.brush), points: [] };
        (this.maskEditing ? l.mask.strokes : l.strokes).push(stroke);
        this.stroke = { id: e.pointerId, layer: l, data: stroke, sampler: new StrokeSampler(this.brush.radius, this.brush.spacing), mirror: new StrokeSampler(this.brush.radius, this.brush.spacing), canvas };
        this.addStrokePoint(e, canvas, hit);
        this.setStatus(this.maskEditing ? 'Painting layer mask…' : 'Painting ' + l.name + '…');
    }
    addStrokePoint(e, canvas, knownHit) {
        const hit = knownHit || this.pick(e, canvas);
        if (!hit) {
            this.stroke.sampler.reset();
            this.stroke.mirror.reset();
            return;
        }
        const pressure = e.pointerType === 'pen' ? Math.max(.02, e.pressure) : 1, points = this.stroke.sampler.add(...hit.uv, pressure);
        if (this.symmetry && hit.ray) {
            const o = [...hit.ray.origin], d = [...hit.ray.direction];
            o[0] *= -1;
            d[0] *= -1;
            const mh = this.bvh.hit(o, d);
            if (mh && Math.hypot(mh.uv[0] - hit.uv[0], mh.uv[1] - hit.uv[1]) > .003)
                points.push(...this.stroke.mirror.add(...mh.uv, pressure));
        }
        for (const p of points) {
            p[0] = Math.max(0, Math.min(1, p[0]));
            p[1] = Math.max(0, Math.min(1, p[1]));
        }
        if (points.length) {
            this.stroke.data.points.push(...points);
            this.pendingPaint.push({ id: this.stroke.layer.id, stroke: this.stroke.data, points });
            this.requestRender();
        }
    }
    pointerMove(e, canvas) {
        if (this.navigation?.id === e.pointerId) {
            const n = this.navigation, dx = e.clientX - n.x, dy = e.clientY - n.y;
            n.x = e.clientX;
            n.y = e.clientY;
            if (n.pan)
                this.camera.pan(dx, dy);
            else
                this.camera.orbit(dx, dy);
            this.requestRender();
            return;
        }
        if (this.stroke?.id === e.pointerId) {
            const events = e.getCoalescedEvents?.() || [];
            for (const event of events.length ? events.slice(-32) : [e])
                this.addStrokePoint(event, canvas);
            return;
        }
        if (canvas.id === 'scene' && ['brush', 'eraser'].includes(this.tool)) {
            const hit = this.pick(e, canvas), cursor = $('#brush-cursor');
            if (hit) {
                const r = canvas.getBoundingClientRect(), size = Math.max(10, this.brush.radius * r.height * 4 / this.camera.distance * 3);
                cursor.style.cssText = `display:block;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${size}px;height:${size}px;`;
                this.hoverUV = hit.uv;
            }
            else
                cursor.style.display = 'none';
        }
    }
    pointerUp(e, canvas) {
        if (this.navigation?.id === e.pointerId)
            this.navigation = null;
        if (this.stroke?.id === e.pointerId)
            this.finishStroke();
        if (canvas.hasPointerCapture(e.pointerId))
            canvas.releasePointerCapture(e.pointerId);
    }
    finishStroke() {
        if (!this.stroke)
            return;
        const s = this.stroke;
        this.stroke = null;
        if (this.pendingPaint.length) {
            for (const batch of this.pendingPaint.splice(0))
                this.engine.paint(batch.id, batch.stroke, batch.points);
            this.renderer.setMaps(this.engine.composite(this.project));
        }
        this.engine.markSynced(s.layer);
        this.changed();
        this.renderLayers();
        if (this.assetsTab === 'History')
            this.renderAssets();
        this.requestRender();
        this.setStatus(`Recorded ${s.data.points.length} brush stamps. Ctrl/⌘ Z to undo.`);
    }
    async pickColor(uv) {
        const maps = await this.engine.read(), N = maps.resolution, x = Math.min(N - 1, Math.max(0, Math.floor(uv[0] * N))), y = Math.min(N - 1, Math.max(0, Math.floor(uv[1] * N))), i = (y * N + x) * 4;
        this.brush.color = rgbToHex(Array.from(maps.color.subarray(i, i + 3), v => v / 255));
        this.brush.metallic = maps.aux[i] / 255;
        this.brush.roughness = maps.aux[i + 1] / 255;
        this.brush.height = maps.aux[i + 2] / 255;
        $('#rail-color').value = this.brush.color;
        this.renderProperties();
        toast('Sampled ' + this.brush.color.toUpperCase() + ' and its PBR channels.');
    }
    registerCommands() {
        const c = this.commands;
        for (const [id, label, fn, key] of [['save', 'Save project to file', () => this.saveProject(), '⌘ S'], ['open', 'Open project', () => $('#project-file').click(), '⌘ O'], ['new', 'New material project', () => this.newDialog(), ''], ['demo', 'Open Artifact 07 demo', () => this.newDemo(), ''], ['export', 'Export texture maps', () => this.exportDialog(), ''], ['glb', 'Export textured GLB', () => this.exportGLBFile(), ''], ['import', 'Import OBJ / GLB mesh', () => $('#mesh-file').click(), ''], ['bake', 'Bake mesh maps', () => this.bakeDialog(), ''], ['paint', 'Add paint layer', () => this.addLayer(), ''], ['fill', 'Add fill layer', () => this.addLayer('fill'), ''], ['undo', 'Undo last edit', () => this.undo(), '⌘ Z'], ['redo', 'Redo edit', () => this.undo(true), '⌘ ⇧ Z'], ['frame', 'Frame model', () => {
                    $('#frame').click();
                }, 'F'], ['mask', 'Paint layer mask', () => this.toggleMaskEditing(), 'M'], ['text', 'Add text decal', () => this.textDecal(), ''], ['screenshot', 'Save viewport screenshot', () => this.screenshot(), ''], ['help', 'Help & keyboard shortcuts', () => this.help(), '?']])
            c.register(id, label, this.guard(fn), key);
    }
    keyboard(e) {
        if (document.querySelector('dialog[open]'))
            return;
        const input = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        if ((e.ctrlKey || e.metaKey) && ['s', 'o', 'k', 'z', 'y'].includes(e.key.toLowerCase())) {
            const k = e.key.toLowerCase();
            if (k === 'z' && input)
                return;
            e.preventDefault();
            if (k === 's')
                this.saveProject();
            if (k === 'o')
                $('#project-file').click();
            if (k === 'k')
                this.commands.palette();
            if (k === 'z')
                this.guard(() => this.undo(e.shiftKey))();
            if (k === 'y')
                this.guard(() => this.undo(true))();
            return;
        }
        if (input)
            return;
        const key = e.key.toLowerCase();
        if (['b', 'e', 'i', 'h'].includes(key)) {
            e.preventDefault();
            this.setTool(({ b: 'brush', e: 'eraser', i: 'picker', h: 'orbit' })[key]);
        }
        if (key === 'f')
            $('#frame').click();
        if (key === 'w')
            $('#wireframe').click();
        if (key === 'x')
            $('#symmetry').click();
        if (key === 'm')
            $('#mask-tool').click();
        if (key === '1')
            this.setView('3d');
        if (key === '2')
            this.setView('2d');
        if (key === '3')
            this.setView('split');
        if (key === '?')
            this.help();
        if (key === '/') {
            e.preventDefault();
            $('#asset-search').focus();
        }
        if (key === '[' || key === ']') {
            const v = Math.max(2, Math.min(160, +$('#brush-size').value * (key === '[' ? .8 : 1.25)));
            $('#brush-size').value = Math.round(v);
            $('#brush-size').dispatchEvent(new Event('input'));
        }
    }
    renameProject() {
        const m = modal('Rename project', `<label class="field">Project name<input id="rename-input" type="text" value="${escapeHTML(this.project.name)}" maxlength="100" autofocus></label><div class="modal-actions"><button id="rename-confirm" class="primary">Save name</button></div>`);
        $('#rename-confirm', m.element).onclick = this.guard(async () => {
            const name = $('#rename-input', m.element).value.trim();
            if (!name)
                throw Error('Enter a project name.');
            await this.mutate('Rename project', () => {
                this.project.name = name;
            });
            m.close();
        });
        $('#rename-input', m.element).onkeydown = e => {
            if (e.key === 'Enter')
                $('#rename-confirm', m.element).click();
        };
    }
    renameLayer(id) {
        const l = this.project.layers.find(l => l.id === id);
        if (!l)
            return;
        const m = modal('Rename layer', `<label class="field">Layer name<input id="rename-layer-input" type="text" value="${escapeHTML(l.name)}" maxlength="100" autofocus></label><div class="modal-actions"><button id="rename-layer-confirm" class="primary">Rename</button></div>`);
        $('#rename-layer-confirm', m.element).onclick = this.guard(async () => {
            const name = $('#rename-layer-input', m.element).value.trim();
            if (!name)
                throw Error('Enter a layer name.');
            await this.mutate('Rename layer', () => {
                l.name = name;
            });
            m.close();
        });
    }
    showMenu(title, entries) {
        const m = modal(title, `<div class="menu-actions">${entries.map(([id, label, glyph, key]) => `<button data-menu="${id}">${icon(glyph)}<span>${escapeHTML(label)}</span><kbd>${key || ''}</kbd></button>`).join('')}</div>`);
        for (const b of m.element.querySelectorAll('[data-menu]'))
            b.onclick = this.guard(() => {
                m.close();
                const id = b.dataset.menu;
                if (id === 'save-local')
                    return this.autosave().then(saved => {
                        if (saved)
                            toast('Saved on this device.');
                    });
                if (id === 'obj')
                    return download(exportOBJ(this.mesh), this.project.name + '.obj', 'text/plain');
                return this.commands.execute(id);
            });
    }
    projectMenu() {
        this.showMenu('Project', [['new', 'New material project', 'plus'], ['demo', 'Open Artifact 07 demo', 'sun'], ['open', 'Open project…', 'folder', '⌘ O'], ['save', 'Save project file…', 'save', '⌘ S'], ['save-local', 'Save on this device', 'check'], ['import', 'Import OBJ / GLB…', 'upload'], ['export', 'Export texture maps…', 'download'], ['glb', 'Export textured GLB…', 'cube'], ['obj', 'Export mesh as OBJ', 'cube']]);
    }
    editMenu() {
        this.showMenu('Edit', [['undo', 'Undo', 'undo', '⌘ Z'], ['redo', 'Redo', 'redo', '⌘ ⇧ Z'], ['paint', 'Add paint layer', 'brush'], ['fill', 'Add fill layer', 'drop'], ['mask', 'Paint layer mask', 'mask', 'M'], ['text', 'Add text decal', 'text']]);
    }
    viewMenu() {
        const m = modal('Viewport', `<div class="menu-actions"><button data-layout="3d">${icon('cube')}3D viewport<kbd>1</kbd></button><button data-layout="2d">${icon('grid')}2D texture viewport<kbd>2</kbd></button><button data-layout="split">${icon('split')}Split 3D / 2D<kbd>3</kbd></button><button id="menu-frame">${icon('cube')}Frame model<kbd>F</kbd></button><button id="menu-settings">${icon('settings')}Lighting & display</button><button id="menu-shot">${icon('camera')}Save viewport PNG</button></div>`);
        for (const b of m.element.querySelectorAll('[data-layout]'))
            b.onclick = () => {
                this.setView(b.dataset.layout);
                m.close();
            };
        $('#menu-frame', m.element).onclick = () => {
            $('#frame').click();
            m.close();
        };
        $('#menu-settings', m.element).onclick = () => {
            m.close();
            this.settings();
        };
        $('#menu-shot', m.element).onclick = () => {
            m.close();
            this.screenshot();
        };
    }
    settings() {
        const m = modal('Lighting & display', `<p>A procedural studio environment lights the surface. Changes affect the preview, not the exported textures.</p>${slider('env-exposure', 'Exposure', this.renderer.exposure, .2, 3, .05)}${slider('env-rotation', 'Environment rotation', Math.round(this.renderer.rotation * 180 / Math.PI), 0, 360, 1, '°')}<label class="field">Environment<select id="env-select"><option value="0">Studio softbox</option><option value="1">Forest overcast</option><option value="2">Warm atelier</option></select></label><div class="property-row"><span>UV wire overlay</span><input type="checkbox" id="env-uv" ${this.uvWire ? 'checked' : ''}></div><p class="help-note">${this.gpu ? 'WebGPU renderer: GGX direct lighting, analytic environment reflections, 4× multisampling, and height-derived surface normals.' : 'Compatibility renderer: WebGL2 or software lighting with CPU painting. Environment rotation and wireframe are unavailable in this backend.'}</p>`);
        $('#env-select', m.element).value = this.renderer.environment;
        $('#env-exposure', m.element).oninput = e => {
            this.renderer.exposure = +e.target.value;
            $('#env-exposure-value', m.element).textContent = e.target.value;
            this.requestRender();
        };
        $('#env-rotation', m.element).disabled = !this.gpu;
        $('#env-select', m.element).disabled = !this.gpu;
        $('#env-rotation', m.element).oninput = e => {
            this.renderer.rotation = +e.target.value * Math.PI / 180;
            $('#env-rotation-value', m.element).textContent = e.target.value + '°';
            this.requestRender();
        };
        $('#env-select', m.element).onchange = e => {
            this.renderer.environment = +e.target.value;
            $('#environment').value = e.target.value;
            this.requestRender();
        };
        $('#env-uv', m.element).onchange = e => {
            this.uvWire = e.target.checked;
            $('#uv-wire').classList.toggle('active', this.uvWire);
            this.requestRender();
        };
    }
    help() {
        const shortcuts = [['Paint', 'B'], ['Erase', 'E'], ['Pick all PBR channels', 'I'], ['Navigate', 'H'], ['Frame model', 'F'], ['Wireframe (WebGPU)', 'W'], ['World-X symmetry', 'X'], ['Paint mask', 'M'], ['Brush smaller / larger', '[ / ]'], ['3D / 2D / split', '1 / 2 / 3'], ['Undo / redo', '⌘ Z / ⌘ ⇧ Z'], ['Save / open project', '⌘ S / ⌘ O'], ['Command palette', '⌘ K'], ['Search assets', '/'], ['Orbit', 'Alt + drag / right drag'], ['Pan', 'Shift + drag / middle drag']];
        modal('Give surfaces a story.', `<p>PatinaStudio is an independent, local-first 3D material-painting workspace. Start on the selected paint layer. Drag directly on the object or on its UV map.</p><div class="help-grid">${shortcuts.map(([label, key]) => `<div><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div><p class="help-note"><b>Materials:</b> click a material to replace the selected fill, or add a new fill above a paint layer. Double-click a layer name to rename it. Drag layers to reorder. Fill layers remain procedural; use a paint layer or a painted mask for strokes.</p><p class="help-note"><b>Save:</b> edits are autosaved in this browser’s IndexedDB. Download a .patina project for a portable copy. Projects contain the mesh, layers, image decals, brush history, and baked maps.</p><p class="help-note"><b>Import:</b> static, uncompressed OBJ or GLB with a complete UV set inside one 0–1 tile. GLB imports geometry, not its existing material textures. Export PNG texture bundles or a self-contained textured GLB.</p><hr><span class="feature-tag">Native WebGPU</span><span class="feature-tag">Compute painting</span><span class="feature-tag">No runtime dependencies</span><p class="help-note">Version 0.1 · Original implementation. Not affiliated with Adobe and not a reader for .spp or .sbsar files. This release does not implement UDIMs, high-to-low cage baking, triplanar projection, or commercial Painter feature parity. On Windows and Linux, use Ctrl in place of ⌘.</p>`, { wide: true });
    }
    newDialog() {
        const m = modal('New material project', `<p>Create a new texture study. Your current project will remain available through Undo, but download a .patina file to keep a separate copy.</p><label class="field">Name<input id="new-name" type="text" value="Untitled material" maxlength="100"></label><label class="field">Starting mesh<select id="new-mesh"><option value="sphere">Shader sphere</option><option value="artifact">Artifact 07</option><option value="torus">Torus</option><option value="cube">UV cube</option></select></label><label class="field">Texture resolution<select id="new-resolution"><option value="256">256</option><option value="512">512</option><option value="1024" selected>1024</option><option value="2048">2048</option></select></label><div class="modal-actions"><button id="new-create" class="primary">Create project</button></div>`);
        if (!this.gpu)
            $('#new-resolution', m.element).value = 512;
        $('#new-create', m.element).onclick = this.guard(async () => {
            const name = $('#new-name', m.element).value.trim() || 'Untitled material', primitive = $('#new-mesh', m.element).value, res = +$('#new-resolution', m.element).value;
            m.close();
            this.setBusy(true, 'Creating project…');
            try {
                await this.mutate('New project', () => {
                    const p = createProject(), base = newLayer('fill', materialById('ceramic'), 'Base material'), paint = newLayer('paint', null, 'Paint layer 01');
                    p.name = name;
                    p.mesh = { primitive };
                    p.resolution = res;
                    p.layers = [base, paint];
                    p.selectedLayer = paint.id;
                    this.project = p;
                    this.camera.reset();
                    this.maskEditing = false;
                    this.brush.radius = +$('#brush-size').value / 2 / res;
                }, { rebuild: true });
            }
            finally {
                this.setBusy(false);
            }
        });
    }
    async newDemo() {
        const m = modal('Open the Artifact 07 study', `<p>Replace the current workspace with the original demo? This is undoable. Save a project file first to keep a separate copy.</p><div class="modal-actions"><button id="load-demo" class="primary">Open demo</button></div>`);
        $('#load-demo', m.element).onclick = this.guard(async () => {
            m.close();
            this.setBusy(true, 'Opening Artifact 07…');
            try {
                await this.mutate('Open demo', () => {
                    this.makeDemo();
                    if (!this.gpu)
                        this.project.resolution = 512;
                    this.camera.reset();
                    this.maskEditing = false;
                }, { rebuild: true });
            }
            finally {
                this.setBusy(false);
            }
        });
    }
    async saveProject() {
        this.finishStroke();
        await this.syncPromise;
        validateProject(this.project);
        download(JSON.stringify(this.project), this.project.name.replace(/[^\w -]/g, '_') + '.patina', 'application/json');
        await this.autosave();
        toast('Project file exported, including editable layers and strokes.');
    }
    async openProject(file) {
        if (file.size > 150 * 1024 * 1024)
            throw Error('Project exceeds the 150 MiB import limit.');
        const data = validateProject(JSON.parse(await file.text()));
        this.checkBudget(data.layers.length, data.resolution);
        this.setBusy(true, 'Opening ' + file.name + '…');
        try {
            await this.mutate('Open project', () => {
                this.project = data;
                this.maskEditing = false;
                this.camera.reset();
                this.brush.radius = +$('#brush-size').value / 2 / data.resolution;
            }, { rebuild: true });
            toast('Opened ' + data.name + '.');
        }
        finally {
            this.setBusy(false);
        }
    }
    async importMesh(file) {
        if (file.size > 80 * 1024 * 1024)
            throw Error('Mesh exceeds the 80 MiB import limit.');
        this.setBusy(true, 'Importing mesh and building acceleration structures…');
        try {
            await raf();
            const mesh = /\.glb$/i.test(file.name) ? parseGLB(await file.arrayBuffer()) : parseOBJ(await file.text());
            for (const uv of mesh.uvs)
                if (uv < -.00001 || uv > 1.00001)
                    throw Error('This release requires UVs inside one 0–1 tile. UDIM and out-of-range UVs are not supported.');
            mesh.name = file.name.replace(/\.[^.]+$/, '');
            await this.mutate('Import mesh', () => {
                this.project.mesh = { data: serializeMesh(mesh) };
                delete this.project.bake;
                this.camera.reset();
            }, { rebuild: true });
            toast(`Imported ${prettySize(mesh.indices.length / 3)} triangles. Existing paint layers are preserved.`);
        }
        finally {
            this.setBusy(false);
        }
    }
    async textDecal() {
        const m = modal('Text decal', `<p>Place text in normalized UV space. A separate raster layer is created, so opacity, masks, blend modes, and paint editing remain available.</p><label class="field">Text<input id="decal-text" type="text" value="PATINA" maxlength="120"></label><div class="property-row"><span>Color</span><input id="decal-color" type="color" value="${this.brush.color}"></div>${slider('decal-u', 'Center U', .5, 0, 1, .01)}${slider('decal-v', 'Center V', .5, 0, 1, .01)}${slider('decal-size', 'Font size (% of texture)', 6, 1, 30, .5)}${slider('decal-angle', 'Rotation', 0, -180, 180, 1, '°')}<div class="modal-actions"><button id="decal-add" class="primary">Add text layer</button></div>`);
        for (const id of ['decal-u', 'decal-v', 'decal-size', 'decal-angle'])
            $('#' + id, m.element).oninput = e => $('#' + id + '-value', m.element).textContent = e.target.value;
        $('#decal-add', m.element).onclick = this.guard(async () => {
            const text = $('#decal-text', m.element).value;
            if (!text.trim())
                throw Error('Enter decal text.');
            const N = this.project.resolution, c = document.createElement('canvas');
            c.width = c.height = N;
            const ctx = c.getContext('2d');
            ctx.translate(+$('#decal-u', m.element).value * N, +$('#decal-v', m.element).value * N);
            ctx.rotate(+$('#decal-angle', m.element).value * Math.PI / 180);
            ctx.fillStyle = $('#decal-color', m.element).value;
            ctx.font = `600 ${+$('#decal-size', m.element).value * N / 100}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
            const image = c.toDataURL();
            m.close();
            await this.addImageLayer(image, text);
        });
    }
    async imageDecal(file) {
        if (file.size > 20 * 1024 * 1024)
            throw Error('Decal image exceeds 20 MiB.');
        const image = await createImageBitmap(file);
        if (image.width * image.height > 64000000) {
            image.close();
            throw Error('Image dimensions exceed the import limit.');
        }
        const m = modal('Place image decal', `<p>Import the image as a separate UV-space layer. Transparent pixels remain transparent.</p>${slider('image-u', 'Center U', .5, 0, 1, .01)}${slider('image-v', 'Center V', .5, 0, 1, .01)}${slider('image-size', 'Texture coverage', 40, 5, 100, 1, '%')}<div class="modal-actions"><button id="image-place" class="primary">Add image layer</button></div>`);
        for (const id of ['image-u', 'image-v', 'image-size'])
            $('#' + id, m.element).oninput = e => $('#' + id + '-value', m.element).textContent = e.target.value;
        let used = false;
        new MutationObserver((_, observer) => {
            if (!m.element.isConnected) {
                if (!used)
                    image.close();
                observer.disconnect();
            }
        }).observe(document.body, { childList: true });
        $('#image-place', m.element).onclick = this.guard(async () => {
            const N = this.project.resolution, c = document.createElement('canvas');
            c.width = c.height = N;
            const ctx = c.getContext('2d'), size = +$('#image-size', m.element).value / 100 * N, ratio = image.width / image.height, w = ratio >= 1 ? size : size * ratio, h = ratio >= 1 ? size / ratio : size;
            ctx.drawImage(image, +$('#image-u', m.element).value * N - w / 2, +$('#image-v', m.element).value * N - h / 2, w, h);
            const url = c.toDataURL();
            used = true;
            image.close();
            m.close();
            await this.addImageLayer(url, file.name);
        });
    }
    async addImageLayer(image, name) {
        this.checkBudget(this.project.layers.length + 1);
        await this.mutate('Add decal', () => {
            const l = newLayer('paint', null, name);
            l.image = image;
            this.project.layers.push(l);
            this.project.selectedLayer = l.id;
            this.maskEditing = false;
        });
        toast('Decal added as an editable layer.');
    }
    bakeDialog() {
        const m = modal('Bake mesh maps', `<p>Rasterize the current mesh into UV space and trace cosine-weighted hemisphere rays for ambient occlusion. Baking runs in a worker so the workspace remains responsive.</p><div class="feature-tag">World-space normals</div><div class="feature-tag">Signed curvature</div><div class="feature-tag">Position</div><div class="feature-tag">Ambient occlusion</div><label class="field">Bake resolution<select id="bake-resolution"><option value="128" selected>128 × 128 — fast preview</option><option value="256">256 × 256 — balanced</option><option value="512">512 × 512 — detailed</option></select></label><label class="field">AO samples per texel<select id="bake-samples"><option value="8">8 samples</option><option value="16" selected>16 samples</option><option value="32">32 samples</option></select></label>${slider('bake-distance', 'Occlusion distance (normalized model units)', .4, .05, 2, .05)}<p class="help-note">This is self-occlusion baking from the current mesh, not high-poly-to-low-poly cage projection. Maps receive four pixels of UV dilation. Exported tangent normals come from the painted height channel.</p><div class="progress-track" hidden id="bake-progress"><div class="progress-bar" id="bake-bar"></div></div><p id="bake-progress-label" class="property-note"></p><div class="modal-actions"><button id="bake-cancel" class="modal-button">Cancel</button><button id="bake-start" class="primary">${icon('bolt', 16)}Bake mesh maps</button></div>`);
        $('#bake-distance', m.element).oninput = e => $('#bake-distance-value', m.element).textContent = e.target.value;
        let cancelled = false, running = false;
        const cancel = () => {
            cancelled = true;
            this.baker.cancel();
            m.close();
        };
        $('#bake-cancel', m.element).onclick = cancel;
        $('.close-modal', m.element).addEventListener('click', () => {
            cancelled = true;
            this.baker.cancel();
        });
        m.element.addEventListener('cancel', () => {
            cancelled = true;
            this.baker.cancel();
        });
        $('#bake-start', m.element).onclick = this.guard(async () => {
            if (running)
                return;
            running = true;
            $('#bake-start', m.element).disabled = true;
            $('#bake-progress', m.element).hidden = false;
            const options = { resolution: +$('#bake-resolution', m.element).value, samples: +$('#bake-samples', m.element).value, maxDistance: +$('#bake-distance', m.element).value, mathURL: import.meta.resolve('@patina/math') };
            const start = performance.now();
            try {
                const maps = await this.baker.run(this.mesh, options, value => {
                    if (!m.element.isConnected) {
                        this.baker.cancel();
                        return;
                    }
                    $('#bake-bar', m.element).style.width = (value * 100) + '%';
                    $('#bake-progress-label', m.element).textContent = 'Tracing ambient occlusion… ' + Math.round(value * 100) + '%';
                });
                if (cancelled)
                    return;
                await this.mutate('Bake mesh maps', () => {
                    this.bakeMaps = maps;
                    this.project.bake = { resolution: maps.resolution, geometry: base64(maps.geometry), surface: base64(maps.surface), settings: { samples: options.samples, maxDistance: options.maxDistance } };
                    this.engine.setGeometry(maps);
                });
                m.close();
                toast(`Baked ${maps.resolution}² maps in ${((performance.now() - start) / 1000).toFixed(1)} s.`);
            }
            finally {
                running = false;
                if (m.element.isConnected)
                    $('#bake-start', m.element).disabled = false;
            }
        });
    }
    exportDialog() {
        const m = modal('Export textures', `<p>Export the composited surface at <b>${this.project.resolution} × ${this.project.resolution}</b>. Files are generated locally from the actual painting engine output.</p><label class="field">Texture set name<input id="export-name" type="text" value="${escapeHTML(this.project.name)}" maxlength="100"></label><label class="field">Normal convention<select id="export-normal"><option value="OpenGL">OpenGL (+Y)</option><option value="DirectX">DirectX (−Y)</option></select></label><div class="property-section"><h3>Included maps</h3>${['Base color · sRGB', 'Metallic · linear', 'Roughness · linear', 'Height · linear', 'Normal · tangent space', 'Ambient occlusion · linear', 'ORM · AO / roughness / metallic'].map(s => `<div class="property-row">${icon('check', 13)}<span>${s}</span><span>PNG</span></div>`).join('')}</div><p class="help-note">The ZIP also contains a channel-packing manifest. For a ready-to-view asset, export a GLB with the mesh and embedded textures.</p><div class="modal-actions"><button id="export-glb" class="modal-button">${icon('cube', 15)}Textured GLB</button><button id="export-start" class="primary">${icon('download', 15)}Export ZIP</button></div>`);
        $('#export-start', m.element).onclick = this.guard(async () => {
            const button = $('#export-start', m.element);
            button.disabled = true;
            button.textContent = 'Reading textures…';
            try {
                this.finishStroke();
                await this.sync();
                const maps = await this.engine.read(), name = $('#export-name', m.element).value || 'Material', convention = $('#export-normal', m.element).value, zip = await exportTextureBundle(maps, name, convention);
                download(zip, name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_textures.zip', 'application/zip');
                m.close();
                toast('Exported seven PNG maps and a packing manifest.');
            }
            finally {
                if (button.isConnected) {
                    button.disabled = false;
                    button.innerHTML = icon('download', 15) + 'Export ZIP';
                }
            }
        });
        $('#export-glb', m.element).onclick = this.guard(async () => {
            m.close();
            await this.exportGLBFile();
        });
    }
    async exportGLBFile() {
        this.setBusy(true, 'Packing mesh and textures into GLB…');
        try {
            this.finishStroke();
            await this.sync();
            const maps = await this.engine.read(), glb = await exportGLB(this.mesh, maps, this.project.name);
            download(glb, this.project.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.glb', 'model/gltf-binary');
            toast('Exported a self-contained textured GLB.');
        }
        finally {
            this.setBusy(false);
        }
    }
    async screenshot() {
        this.renderer.render(this.camera);
        const blob = await new Promise(resolve => $('#scene').toBlob(resolve, 'image/png'));
        if (!blob)
            throw Error('Viewport image capture failed.');
        download(blob, this.project.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_viewport.png', 'image/png');
        toast('Viewport PNG exported.');
    }
}
const studio = new Studio();
window.patina = studio;
window.addEventListener('unhandledrejection', e => {
    studio.error(e.reason);
});
studio.init().catch(e => {
    studio.setBusy(false);
    studio.error(e);
    const m = modal('Workspace could not initialize', `<p>${escapeHTML(e.message)}</p><p>Serve this app from localhost or HTTPS. A modern browser is required. WebGPU is recommended; WebGL2 and a software preview are available as fallbacks.</p><div class="modal-actions"><button id="retry-start" class="primary">Retry in compatibility mode</button></div>`);
    $('#retry-start', m.element).onclick = () => {
        const u = new URL(location.href);
        u.searchParams.set('backend', 'cpu');
        location.href = u.href;
    };
});
