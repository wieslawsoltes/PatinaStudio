"""Require real WebGPU shader compilation/execution on a software GPU in CI.

Unlike pages_smoke.py, this test must fail rather than accept the application's
CPU fallback. It exercises the built distribution at the Pages project path.
SwiftShader validates the WebGPU API and WGSL; it is not physical-GPU coverage.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import json
import os
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
out = Path(os.environ.get('PATINA_GPU_ARTIFACTS', 'test-artifacts/webgpu')).resolve()
out.mkdir(parents=True, exist_ok=True)
assert (root / 'dist/index.html').is_file(), 'Run npm run build first.'
report = {'passed': False, 'mode': 'Chromium WebGPU / SwiftShader',
          'hardwareWebGPUValidated': False, 'pageErrors': [], 'consoleErrors': [],
          'failedRequests': []}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()


with TemporaryDirectory(prefix='patina-webgpu-') as temp:
    (Path(temp) / 'PatinaStudio').symlink_to(root / 'dist', target_is_directory=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=temp))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/PatinaStudio/'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=[
                '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
                '--use-angle=swiftshader', '--disable-dev-shm-usage',
            ])
            try:
                report['browserVersion'] = browser.version
                page = browser.new_page(viewport={'width': 1280, 'height': 800})
                page.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
                page.on('console', lambda m: report['consoleErrors'].append(m.text)
                        if m.type == 'error' else None)
                page.on('response', lambda r: report['failedRequests'].append(f'{r.status} {r.url}')
                        if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)

                # This page compiles all four compute pipelines, compares all
                # five blend modes and painted masks against the CPU engine,
                # then submits PBR/background/wireframe/UV render commands.
                response = page.goto(base + 'examples/gpu-validation.html', wait_until='load')
                assert response and response.status == 200
                page.wait_for_function('!!window.__PATINA_GPU_REPORT', timeout=120000)
                report['pipelines'] = page.evaluate('window.__PATINA_GPU_REPORT')
                report['pipelineLog'] = page.locator('#log').inner_text()
                assert report['pipelines']['status'] == 'passed', report['pipelines']

                # Exercise the exact startup path that previously threw
                # "Pressure brush: 27:31 'target' is a reserved keyword".
                page.goto(base, wait_until='load')
                page.wait_for_function('window.__PATINA_READY === true || !!document.querySelector("dialog")',
                                       timeout=120000)
                report['workspace'] = page.evaluate('''async () => {
                    const s = window.patina;
                    if (s?.gpu) await s.gpu.device.queue.onSubmittedWorkDone();
                    return {ready: !!window.__PATINA_READY, gpu: !!s?.gpu,
                        engine: s?.engine?.constructor.name,
                        renderer: s?.renderer?.constructor.name,
                        brushPipeline: !!s?.engine?.brushPipeline,
                        errors: s?.gpu?.errors || [],
                        dialogs: [...document.querySelectorAll('dialog')].map(d => d.innerText)};
                }''')
                state = report['workspace']
                assert state['ready'] and state['gpu'], state
                assert state['engine'] == 'GPUPaintEngine', state
                assert state['renderer'] == 'GPURenderer' and state['brushPipeline'], state
                assert not state['errors'] and not state['dialogs'], state
                page.wait_for_function('patina.renderer.frames > 0', timeout=30000)
                page.screenshot(path=str(out / 'webgpu-workspace.png'))
                assert not report['pageErrors'], report['pageErrors']
                assert not report['consoleErrors'], report['consoleErrors']
                assert not report['failedRequests'], report['failedRequests']
                report['passed'] = True
            finally:
                browser.close()
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        server.shutdown()
        server.server_close()
        (out / 'webgpu-report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2), flush=True)
