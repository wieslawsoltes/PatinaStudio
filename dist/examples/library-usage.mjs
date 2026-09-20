/** Standalone Node usage: no Studio, no DOM, no renderer and no external packages. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createProject,newLayer} from '@patina/project';
import {materialById} from '@patina/materials';
import {CPUPaintEngine} from '@patina/paint';
import {createCube} from '@patina/mesh';
import {BVH} from '@patina/math';
import {bakeMaps} from '@patina/baker';

const project=createProject();project.resolution=256;
const base=newLayer('fill',materialById('copper'));
const paint=newLayer('paint',null,'Reusable engine sample');
project.layers=[base,paint];project.selectedLayer=paint.id;
paint.strokes.push({mode:0,settings:{radius:.12,color:'#419b87',metallic:.45,roughness:.7,height:.56,hardness:.25,flow:.9,shape:0,pressureSize:true,pressureOpacity:true},points:[[.25,.5,.5],[.4,.5,.7],[.55,.5,1],[.7,.5,.7]]});
const engine=await new CPUPaintEngine(null,256).init();
try{
  const bake=await bakeMaps(createCube(),{resolution:32,samples:4,maxDistance:.4,BVH});
  engine.setGeometry(bake);await engine.sync(project);engine.composite(project);
  const maps=await engine.read(),rgb=new Uint8Array(256*256*3);
  for(let i=0,j=0;i<maps.color.length;i+=4){rgb[j++]=maps.color[i];rgb[j++]=maps.color[i+1];rgb[j++]=maps.color[i+2];}
  await mkdir('generated',{recursive:true});
  await writeFile('generated/material.ppm',Buffer.concat([Buffer.from('P6\n256 256\n255\n'),rgb]));
  await writeFile('generated/material.patina',JSON.stringify(project,null,2));
  console.log('Wrote generated/material.ppm and generated/material.patina using standalone packages.');
}finally{engine.dispose();}
