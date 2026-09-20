import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(os.environ.get('PATINA_ARTIFACTS','/mnt/data/patina-test-artifacts')); out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1,accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:print('BROWSER',m.type,m.text[:1800],flush=True) if m.type in ['error','warning'] else None)
    page.goto('http://localhost:4173',wait_until='domcontentloaded')
    try: page.wait_for_function('window.__PATINA_READY === true',timeout=90000)
    except Exception as e: print('READY FAILED',e,flush=True)
    print('STATE',page.evaluate('({ready:window.__PATINA_READY,gpu:!!window.patina?.gpu,errors:window.patina?.gpu?.errors,layers:window.patina?.project?.layers?.length,dialogs:[...document.querySelectorAll("dialog")].map(d=>d.innerText)})'),flush=True)
    page.screenshot(path=str(out/'initial.png'),full_page=True)
    print('PAGE_ERRORS',json.dumps(errors),flush=True)
    browser.close()
