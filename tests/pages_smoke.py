"""Exercise the built app at a GitHub-Pages-style repository subpath.

Requires Python Playwright and its Chromium installation. Uses a real HTTP
origin, unmodified application modules and an actual module worker. GPU
rendering is disabled deliberately; this test certifies software fallback,
asset routing, origin storage access and worker loading, not GPU hardware.
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
out = Path(os.environ.get('PATINA_ARTIFACTS', 'test-artifacts/pages')).resolve()
out.mkdir(parents=True, exist_ok=True)
assert (root / 'dist/index.html').is_file(), 'Run npm run build first.'
errors, failed_requests = [], []

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with TemporaryDirectory(prefix='patina-pages-') as temp:
    (Path(temp) / 'PatinaStudio').symlink_to(root / 'dist', target_is_directory=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=temp))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/PatinaStudio/'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--disable-gpu', '--disable-webgl'])
            try:
                page = browser.new_page(viewport={'width': 1600, 'height': 1000})
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda response: failed_requests.append(f'{response.status} {response.url}') if response.status >= 400 and not response.url.endswith('/favicon.ico') else None)
                response = page.goto(base, wait_until='networkidle')
                assert response and response.status == 200
                page.wait_for_function('window.__PATINA_READY === true', timeout=90000)
                backend = page.locator('#status-backend').inner_text()
                assert 'Software' in backend, backend
                worker_result = page.evaluate('''async () => {
                    const {BakeWorker} = await import('./packages/baker/src/index.js');
                    const {createCube} = await import('./packages/mesh/src/index.js');
                    const baker = new BakeWorker();
                    try {
                        const maps = await baker.run(createCube(), {
                            resolution: 16, samples: 1, maxDistance: .4,
                            mathURL: new URL('./packages/math/src/index.js', location.href).href
                        });
                        return {geometryBytes: maps.geometry.length, surfaceBytes: maps.surface.length};
                    } finally { baker.cancel(); }
                }''')
                assert worker_result == {'geometryBytes': 1024, 'surfaceBytes': 1024}, worker_result
                storage = page.evaluate('''() => new Promise((resolve, reject) => {
                    const name = 'patina-pages-smoke-' + Date.now();
                    const request = indexedDB.open(name, 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('probe');
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result;
                        const write = db.transaction('probe', 'readwrite');
                        write.objectStore('probe').put('ok', 'value');
                        write.onerror = () => {db.close(); reject(write.error);};
                        write.oncomplete = () => {
                            const read = db.transaction('probe').objectStore('probe').get('value');
                            read.onerror = () => {db.close(); reject(read.error);};
                            read.onsuccess = () => {
                                const value = read.result; db.close();
                                indexedDB.deleteDatabase(name); resolve(value);
                            };
                        };
                    };
                })''')
                assert storage == 'ok', storage
                page.screenshot(path=str(out / 'pages-workspace.png'))
                assert not errors, errors
                assert not failed_requests, failed_requests
                report = {'passed': True, 'basePath': '/PatinaStudio/', 'backend': backend,
                          'moduleWorker': worker_result, 'indexedDBRoundTrip': storage,
                          'pageErrors': errors, 'failedRequests': failed_requests,
                          'hardwareWebGPUValidated': False}
                (out / 'pages-report.json').write_text(json.dumps(report, indent=2))
                print(json.dumps(report, indent=2))
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
