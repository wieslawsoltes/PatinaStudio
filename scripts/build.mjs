import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const f of ['index.html', 'LICENSE', 'app', 'packages', 'examples'])
    await cp(f, 'dist/' + f, { recursive: true });
console.log('Static build ready in dist/. No bundler or runtime dependencies.');
