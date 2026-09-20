"""DOM/software fallback integration test, without navigating outside about:blank.
Routes only this checked-out application's subresources. Does not change policies.
"""
import json, mimetypes, os, time
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=Path(os.environ.get('PATINA_ARTIFACTS','/mnt/data/patina-test-artifacts')); out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1,accept_downloads=True)
    def route(r):
        path=(root / unquote(urlparse(r.request.url).path).lstrip('/')).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            r.fulfill(status=404,body='Not found'); return
        mime='text/javascript' if path.suffix in ['.js','.mjs'] else mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        r.fulfill(status=200,body=path.read_bytes(),headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    context.route('http://localhost:4173/**',route)
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:print('BROWSER',m.type,m.text[:2000],flush=True) if m.type in ['error','warning'] else None)
    source=(root/'index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/">',1)
    page.set_content(source,wait_until='load')
    try: page.wait_for_function('window.__PATINA_READY === true',timeout=90000)
    except Exception as e: print('READY FAILED',e,flush=True)
    print('STATE',page.evaluate('({ready:window.__PATINA_READY,renderer:window.patina?.renderer?.constructor.name,gpu:!!window.patina?.gpu,layers:window.patina?.project?.layers?.length,dialogs:[...document.querySelectorAll("dialog")].map(d=>d.innerText)})'),flush=True)
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out/'initial.png'),full_page=True)
    checks=[]
    def check(name, condition):
        assert condition, name
        checks.append(name)
        print('PASS',name,flush=True)
    check('workspace initializes without page errors',not errors and page.evaluate('window.__PATINA_READY'))
    check('honest software backend label','Software' in page.locator('#status-backend').inner_text())
    # The restricted environment cannot navigate to localhost, but these are real
    # UI events, original modules, and actual engine pixels, not a mocked engine.
    page.select_option('#resolution','256')
    page.wait_for_function("patina.project.resolution===256 && !document.querySelector('#busy-overlay').classList.contains('visible')",timeout=60000)
    page.locator('#property-color').evaluate("e=>{e.value='#ee2244';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#brush-flow').evaluate("e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    page.locator('#brush-hardness').evaluate("e=>{e.value='90';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    def stamp(selector,u,v):
        box=page.locator(selector).bounding_box()
        page.mouse.move(box['x']+box['width']*u,box['y']+box['height']*v)
        page.mouse.down();page.mouse.up()
        page.wait_for_function('!patina.stroke && !patina.pendingPaint.length',timeout=30000)
    stamp('#uv-canvas',.5,.5)
    check('UV pointer paints and records semantic stroke',page.evaluate('patina.selected.strokes.length===1 && patina.selected.strokes[0].points.length>0'))
    check('brush modifies actual texture pixels',page.evaluate("(()=>{const s=patina.engine.layers.get(patina.selected.id),i=(128*256+128)*4;return s.color[i]>220&&s.color[i+1]<45&&s.color[i+3]>240})()"))
    page.click('#undo');page.wait_for_function("!document.querySelector('#busy-overlay').classList.contains('visible')&&patina.selected.strokes.length===0",timeout=60000)
    check('undo reconstructs a clean layer',page.evaluate('patina.selected.strokes.length===0'))
    page.click('#redo');page.wait_for_function("!document.querySelector('#busy-overlay').classList.contains('visible')&&patina.selected.strokes.length===1",timeout=60000)
    check('redo replays the stroke',page.evaluate('patina.selected.strokes.length===1'))
    stamp('#scene',.5,.43)
    check('3D surface picking produces UV paint',page.evaluate('patina.selected.strokes.length===2'))
    page.click('#mask-tool');page.wait_for_function('patina.maskEditing && !patina.syncRunning',timeout=30000)
    page.click('#mask-black');stamp('#uv-canvas',.5,.5)
    check('mask painting changes real mask pixels',page.evaluate("(()=>{const s=patina.engine.layers.get(patina.selected.id);return patina.selected.mask.strokes.length===1&&s.mask[(128*256+128)*4]<20})()"))
    page.click('#text-decal');page.fill('#decal-text','TEST 07');page.click('#decal-add')
    page.wait_for_function("patina.selected.name==='TEST 07' && !patina.syncRunning",timeout=30000)
    check('text decal creates an editable image layer',page.evaluate("patina.selected.type==='paint'&&patina.selected.image.startsWith('data:image/png')"))
    stamp('#uv-canvas',.1,.1)
    before=page.evaluate("Array.from(patina.engine.layers.get(patina.selected.id).color.slice((25*256+25)*4,(25*256+25)*4+4))")
    await_replay=page.evaluate("async()=>{const l=patina.selected;patina.engine.layers.get(l.id).key='force-replay';await patina.sync();return Array.from(patina.engine.layers.get(l.id).color.slice((25*256+25)*4,(25*256+25)*4+4));}")
    check('painting survives decal replay',before==await_replay and before[3]>200)
    page.click('#export');page.select_option('#export-normal','DirectX')
    with page.expect_download(timeout=60000) as dl:
        page.click('#export-start')
    texpath=out/'browser-textures.zip';dl.value.save_as(str(texpath))
    import zipfile
    with zipfile.ZipFile(texpath) as z:
        check('texture export contains seven PNGs and correct manifest',len([n for n in z.namelist() if n.endswith('.png')])==7 and json.loads(z.read('manifest.json'))['normalConvention']=='DirectX')
        check('exported textures have valid PNG signatures',all(z.read(n).startswith(bytes([137,80,78,71,13,10,26,10])) for n in z.namelist() if n.endswith('.png')))
    with page.expect_download(timeout=60000) as dl:
        page.evaluate('patina.exportGLBFile()')
    glbpath=out/'browser-material.glb';dl.value.save_as(str(glbpath))
    import struct
    blob=glbpath.read_bytes();meta=json.loads(blob[20:20+struct.unpack_from('<I',blob,12)[0]])
    check('GLB export embeds geometry and three textures',blob[:4]==b'glTF' and len(meta['images'])==3 and meta['materials'][0]['pbrMetallicRoughness']['metallicRoughnessTexture']['index']==1)
    check('GLB geometry import round-trips exported mesh',page.evaluate("async()=>{const io=await import('@patina/io');const bytes=await io.exportGLB(patina.mesh,await patina.engine.read());return io.parseGLB(bytes.buffer).indices.length===patina.mesh.indices.length;}") )
    with page.expect_download(timeout=30000) as dl:
        page.evaluate('patina.saveProject()')
    projectpath=out/'browser-session.patina';dl.value.save_as(str(projectpath))
    saved=json.loads(projectpath.read_text())
    check('project export preserves layers, decals and strokes',saved['format']=='patina-project' and len(saved['layers'])==6 and saved['layers'][-1]['strokes'])
    page.click('#command');page.wait_for_selector('dialog[open]')
    check('command palette is operational','Save project' in page.locator('dialog[open]').inner_text())
    page.keyboard.press('Escape')
    page.select_option('#channel','4')
    check('normal-channel inspection updates renderer',page.evaluate('patina.renderer.channel===4'))
    page.select_option('#channel','0')
    page.set_viewport_size({'width':1100,'height':760});page.wait_for_timeout(1000)
    check('compact desktop layout does not overflow horizontally',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    page.screenshot(path=str(out/'compact.png'),full_page=True)
    check('no uncaught browser page errors after all workflows',not errors)
    print('PAGE_ERRORS',json.dumps(errors),flush=True)
    (out/'browser-report.json').write_text(json.dumps({'pageErrors':errors,'checks':checks,'passed':len(checks),'mode':'about:blank isolated DOM, software rasterizer, CPU painting','notVerified':['WebGPU runtime','WebGL2 runtime','IndexedDB persistent origin','worker loading from HTTP origin'],'state':page.evaluate('({ready:window.__PATINA_READY,renderer:window.patina?.renderer?.constructor.name,gpu:!!window.patina?.gpu,layers:window.patina?.project?.layers?.length})')},indent=2))
    browser.close()
