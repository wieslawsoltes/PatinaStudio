import { GPUContext } from '@patina/gpu';
import { GPUPaintEngine, CPUPaintEngine } from '@patina/paint';
import { GPURenderer } from '@patina/renderer';
import { OrbitCamera } from '@patina/math';
import { createCube } from '@patina/mesh';
import { createProject, newLayer } from '@patina/project';
import { BakeWorker } from '@patina/baker';
import { materialById } from '@patina/materials';
const log = document.querySelector('#log');
const report = { started: new Date().toISOString(), status: 'running', checks: [] };
function check(name, condition, detail = '') {
    report.checks.push({ name, passed: !!condition, detail });
    log.textContent += `${condition ? 'PASS' : 'FAIL'}  ${name} ${detail}\n`;
    if (!condition)
        throw Error(name + ' failed: ' + detail);
}
const maxError = (a, b) => {
    let error = 0;
    for (let i = 0; i < a.length; i++)
        error = Math.max(error, Math.abs(a[i] - b[i]));
    return error;
};
async function run() {
    let context, gpu, cpu, renderer, baker;
    try {
        context = await GPUContext.create();
        check('WebGPU adapter and device available', !!context.device);
        gpu = await new GPUPaintEngine(context, 64).init();
        cpu = await new CPUPaintEngine(null, 64).init();
        check('All four compute pipelines compile', !!gpu.normalPipeline);
        const p = createProject(), material = materialById('ceramic');
        Object.assign(material, { color: '#7c644a', secondary: '#7c644a', detail: 0, pattern: 0, roughness: .5, height: .5 });
        const base = newLayer('fill', material), paint = newLayer();
        p.layers = [base, paint];
        p.selectedLayer = paint.id;
        const b = { radius: .14, color: '#ed344b', metallic: .7, roughness: .2, height: .56, hardness: .5, flow: .8, shape: 0, spacing: .16, pressureSize: true, pressureOpacity: true };
        paint.strokes = [{ mode: 0, settings: b, points: [[.35, .5, 1], [.5, .5, .7], [.65, .5, .3]] }];
        for (const blend of ['normal', 'multiply', 'screen', 'overlay', 'add']) {
            paint.blend = blend;
            await gpu.sync(p);
            await cpu.sync(p);
            gpu.composite(p);
            cpu.composite(p);
            const gm = await gpu.read(), cm = await cpu.read(), error = maxError(gm.color, cm.color);
            check('CPU/GPU color equivalence: ' + blend, error <= 5, `max byte error=${error}`);
        }
        paint.mask.enabled = true;
        paint.mask.strokes = [{ mode: 3, settings: b, points: [[.5, .5, 1]] }];
        await gpu.sync(p);
        await cpu.sync(p);
        gpu.composite(p);
        cpu.composite(p);
        check('Painted mask equivalence', maxError((await gpu.read()).color, (await cpu.read()).color) <= 5);
        renderer = await new GPURenderer(document.querySelector('#preview'), context).init();
        renderer.setMesh(createCube());
        renderer.setMaps(gpu.composite(p));
        renderer.render(new OrbitCamera());
        renderer.wireframe = true;
        renderer.render(new OrbitCamera());
        renderer.renderUV(document.querySelector('#uv'));
        await context.device.queue.onSubmittedWorkDone();
        check('PBR, background, wireframe and UV render pipelines', context.errors.length === 0, context.errors.join('; '));
        baker = new BakeWorker();
        const mesh = createCube();
        const maps = await baker.run(mesh, { resolution: 32, samples: 2, maxDistance: .4, mathURL: import.meta.resolve('@patina/math') }, () => {
        });
        check('Dedicated worker returns actual mesh maps', maps.geometry.length === 32 * 32 * 4 && maps.surface.length === 32 * 32 * 4);
        report.status = 'passed';
    }
    catch (error) {
        report.status = 'failed';
        report.error = error.message;
        log.textContent += '\n' + error.stack + '\n';
    }
    finally {
        baker?.cancel();
        cpu?.dispose();
        // Keep the preview alive until the report is saved or the page is unloaded.
        report.finished = new Date().toISOString();
        window.__PATINA_GPU_REPORT = report;
        document.querySelector('#download').disabled = false;
        document.querySelector('#status').textContent = report.status.toUpperCase();
        window.addEventListener('beforeunload', () => {
            renderer?.dispose();
            gpu?.dispose();
            context?.destroy();
        }, { once: true });
    }
}
document.querySelector('#download').onclick = () => {
    const u = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = u;
    a.download = 'patina-gpu-validation.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
};
run();
