import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(p) {
    for (const e of await readdir(p, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git'].includes(e.name))
            continue;
        const f = p + '/' + e.name;
        if (e.isDirectory())
            await walk(f);
        else if (/\.(js|mjs)$/.test(f)) {
            const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
            if (r.status) {
                console.error(r.stderr);
                process.exitCode = 1;
            }
        }
    }
}
await walk('.');
if (!process.exitCode)
    console.log('All JavaScript syntax checks passed.');
