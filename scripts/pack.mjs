import {mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const target=path.resolve('archives');await mkdir(target,{recursive:true});
for(const directory of await readdir('packages')){
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['pack','--pack-destination',target],{cwd:path.resolve('packages',directory),stdio:'inherit'});
}
console.log('Standalone npm tarballs are in archives/.');
