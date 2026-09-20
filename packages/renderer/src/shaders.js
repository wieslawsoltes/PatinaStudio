export const commonWGSL = /*wgsl*/ `
struct Camera {mvp:mat4x4f, inverse:mat4x4f, eye:vec4f, params:vec4f, viewport:vec4f, brush:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var texSampler:sampler;
@group(0) @binding(2) var colorMap:texture_2d<f32>;
@group(0) @binding(3) var auxMap:texture_2d<f32>;
@group(0) @binding(4) var normalMap:texture_2d<f32>;
fn aces(c:vec3f)->vec3f {return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),vec3f(0),vec3f(1));}
fn env(d0:vec3f,rough:f32)->vec3f {
 let a=camera.params.y;let d=vec3f(d0.x*cos(a)+d0.z*sin(a),d0.y,-d0.x*sin(a)+d0.z*cos(a));
 var c=mix(vec3f(.055,.065,.065),vec3f(.52,.65,.73),smoothstep(-.2,.8,d.y))*.7;
 let warm=pow(max(0.,dot(d,normalize(vec3f(-.6,.65,.6)))),mix(100.,2.5,rough));
 let cool=pow(max(0.,dot(d,normalize(vec3f(.7,.2,.5)))),mix(130.,3.,rough));
 let strip=pow(max(0.,dot(d,normalize(vec3f(-.65,.2,-.6)))),mix(180.,3.,rough));
 c+=vec3f(2.8,2.5,1.95)*warm+vec3f(.85,1.35,1.7)*cool+vec3f(1.45,1.7,1.6)*strip;
 if(camera.viewport.z==1.){c=mix(c,vec3f(c.r*.95,c.g*1.1,c.b*.9),.55);}
 if(camera.viewport.z==2.){c=mix(c,vec3f(c.r*1.4,c.g*.8,c.b*.56),.5);}
 return c;
}
fn brdf(n:vec3f,v:vec3f,l:vec3f,base:vec3f,metal:f32,rough:f32,radiance:vec3f)->vec3f {
 let h=normalize(v+l);let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.);let vh=max(dot(v,h),0.);
 let a=rough*rough;let a2=a*a;let den=nh*nh*(a2-1.)+1.;let D=a2/(3.14159265*den*den+.00001);
 let k=(rough+1.)*(rough+1.)/8.;let G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
 let F0=mix(vec3f(.04),base,metal);let F=F0+(1.-F0)*pow(1.-vh,5.);
 return ((1.-F)*(1.-metal)*base/3.14159265+D*G*F/max(4.*nl*nv,.001))*radiance*nl;
}
`;
export const meshWGSL = commonWGSL + /*wgsl*/ `
struct VertexIn {@location(0) position:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f};
struct VertexOut {@builtin(position) clip:vec4f,@location(0) position:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f};
@vertex fn vs(v:VertexIn)->VertexOut {var o:VertexOut;o.clip=camera.mvp*vec4f(v.position,1.);o.position=v.position;o.normal=v.normal;o.uv=v.uv;return o;}
@fragment fn fs(i:VertexOut,@builtin(front_facing) front:bool)->@location(0) vec4f {
 let albedo=textureSample(colorMap,texSampler,i.uv);let aux=textureSample(auxMap,texSampler,i.uv);let nm=textureSample(normalMap,texSampler,i.uv).rgb*2.-1.;
 let px=dpdx(i.position);let py=dpdy(i.position);let ux=dpdx(i.uv);let uy=dpdy(i.uv);let n0=normalize(i.normal);
 let tangent=px*uy.y-py*ux.y;let bitangent=-px*uy.x+py*ux.x;let inv=max(max(length(tangent),length(bitangent)),.000001);
 let n=normalize(n0*nm.z+(tangent*nm.x-bitangent*nm.y)/inv*.62);let v=normalize(camera.eye.xyz-i.position);let base=pow(albedo.rgb,vec3f(2.2));let rough=clamp(aux.g,.065,1.);let metal=aux.r;let ao=aux.a;
 var c=brdf(n,v,normalize(vec3f(-3,4,4)),base,metal,rough,vec3f(4.2,3.65,2.9));
 c+=brdf(n,v,normalize(vec3f(3,1.8,1)),base,metal,rough,vec3f(1.3,1.8,2.1));
 c+=brdf(n,v,normalize(vec3f(-2,1,-3)),base,metal,rough,vec3f(1.7,2.1,2.1));
 let F0=mix(vec3f(.04),base,metal);let fresnel=F0+(max(vec3f(1.-rough),F0)-F0)*pow(1.-max(dot(n,v),0.),5.);
 c+=(base*(1.-metal)*env(n,1.)*.48+env(reflect(-v,n),rough)*fresnel*.75)*ao;
 c=pow(aces(c*camera.params.x),vec3f(1./2.2));let mode=u32(camera.params.z);
 if(mode==1u){c=albedo.rgb;}if(mode==2u){c=vec3f(aux.g);}if(mode==3u){c=vec3f(aux.r);}if(mode==4u){c=n*.5+.5;}if(mode==5u){c=vec3f(aux.b);}if(mode==6u){c=vec3f(aux.a);}if(mode==7u){let checker=(u32(floor(i.uv.x*16.))+u32(floor(i.uv.y*16.)))%2u;c=select(vec3f(.16,.25,.24),vec3f(.65,.8,.69),checker==0u);}
 return vec4f(c,1.);
}
@fragment fn wire()->@location(0) vec4f {return vec4f(.68,.86,.73,.2);}
`;
export const fullscreenWGSL = commonWGSL + /*wgsl*/ `
struct FullOut {@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->FullOut {var o:FullOut;let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));o.position=vec4f(uv*2.-1.,.999,1.);o.uv=vec2f(uv.x,1.-uv.y);return o;}
@fragment fn background(i:FullOut)->@location(0) vec4f {
 let screen=i.uv*2.-1.;let vignette=clamp(1.-length(screen)*.28,0.,1.);var c=mix(vec3f(.078,.094,.094),vec3f(.157,.183,.178),vignette);
 let q=camera.inverse*vec4f(screen.x,-screen.y,1.,1.);let ray=normalize(q.xyz/q.w-camera.eye.xyz);let t=(-1.395-camera.eye.y)/select(ray.y,.000001,abs(ray.y)<.000001);
 let point=camera.eye.xyz+ray*t;let coord=point.xz*2.;let deriv=max(fwidth(coord),vec2f(.0001));
 if(t>0.){let dist=length(point.xz);let fade=exp(-dist*.13);c=mix(c,vec3f(.135,.155,.151),fade*.8);let shadow=exp(-dot(point.xz*vec2f(.9,1.3),point.xz*vec2f(.9,1.3))*2.2);c*=1.-shadow*.66;
 let grid=abs(fract(coord-.5)-.5)/deriv;let line=1.-clamp(min(grid.x,grid.y),0.,1.);c+=vec3f(.047,.062,.057)*line*fade*.42;
 }
 c=mix(c,vec3f(.09,.105,.1),smoothstep(.65,1.3,length(screen))*.25);
 return vec4f(c,1.);
}
@fragment fn uvFragment(i:FullOut)->@location(0) vec4f {
 let uv=(i.uv-.5)/camera.viewport.w+.5;let a=textureSample(colorMap,texSampler,uv);let b=textureSample(auxMap,texSampler,uv);let n=textureSample(normalMap,texSampler,uv);let mode=u32(camera.params.z);var c=a.rgb;
 if(mode==2u){c=vec3f(b.g);}if(mode==3u){c=vec3f(b.r);}if(mode==4u){c=n.rgb;}if(mode==5u){c=vec3f(b.b);}if(mode==6u){c=vec3f(b.a);}if(mode==7u){c=select(vec3f(.1,.2,.18),vec3f(.7,.85,.7),(u32(floor(uv.x*16.))+u32(floor(uv.y*16.)))%2u==0u);}
 if(any(uv<vec2f(0))||any(uv>vec2f(1))){c=vec3f(.085,.1,.095);}
 return vec4f(c,1.);
}
`;
