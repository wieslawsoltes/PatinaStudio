export const noiseWGSL = /*wgsl*/ `
fn hash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn noise(p:vec2f)->f32 {let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2f(1,0)),u.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),u.x),u.y);}
fn fbm(p0:vec2f)->f32 {var p=p0;var a=.5;var s=0.;for(var i=0;i<5;i++){s+=noise(p)*a;p=p*2.03+vec2f(3.7,1.8);a*=.5;}return s;}
`;
export const fillWGSL = noiseWGSL + /*wgsl*/ `
struct Params { color:vec4f, secondary:vec4f, properties:vec4f, config:vec4f };
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var outColor:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(2) var outAux:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(3) var outMask:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
 let dim=textureDimensions(outColor);if(any(id.xy>=dim)){return;}
 let uv=(vec2f(id.xy)+.5)/vec2f(dim);let n=fbm(uv*p.config.x);let grain=noise(uv*420.);var f=.72+n*.28;var h=.5+(grain-.5)*p.properties.w*.08;let pattern=u32(p.config.y);
 if(pattern==2u){f=clamp((n-.25)*1.7,0.,1.);h=.48+n*.08+(grain-.5)*.024;}
 if(pattern==3u){f=.75+noise(uv*vec2f(9.,900.))*.25;h=.5+(f-.85)*.016;}
 if(pattern==4u){f=.5+.5*sin(uv.x*p.config.x*16.+fbm(uv*p.config.x)*12.);h=.48+f*.04;}
 if(pattern==5u){f=n*.6+grain*.4;h=.44+f*.12;}
 if(pattern==6u){f=.7+.3*sin(uv.x*p.config.x*35.)*sin(uv.y*p.config.x*35.);h=.46+f*.08;}
 let color=mix(p.secondary.rgb,p.color.rgb,f);
 textureStore(outColor,id.xy,vec4f(color,p.color.a));
 textureStore(outAux,id.xy,vec4f(p.properties.x,clamp(p.properties.y+(grain-.5)*p.properties.w*.15,.045,1.),clamp(h+p.properties.z-.5,0.,1.),p.color.a));
 textureStore(outMask,id.xy,vec4f(p.config.z,p.config.z,p.config.z,1.));
}
`;
export const brushWGSL = noiseWGSL + /*wgsl*/ `
struct Params {color:vec4f,aux:vec4f,config:vec4f,rect:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> stamps:array<vec4f>;
@group(0) @binding(2) var srcColor:texture_2d<f32>;
@group(0) @binding(3) var srcAux:texture_2d<f32>;
@group(0) @binding(4) var srcMask:texture_2d<f32>;
@group(0) @binding(5) var outColor:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(6) var outAux:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(7) var outMask:texture_storage_2d<rgba8unorm,write>;
fn over(old:vec4f,col:vec3f,a:f32)->vec4f {let oa=a+old.a*(1.-a);return vec4f((col*a+old.rgb*old.a*(1.-a))/max(oa,.00001),oa);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
 let xy=vec2i(id.xy)+vec2i(p.rect.xy);let dim=textureDimensions(srcColor);
 if(any(id.xy>=vec2u(p.rect.zw))||any(xy>=vec2i(dim))){return;}
 var c=textureLoad(srcColor,xy,0);var a=textureLoad(srcAux,xy,0);var m=textureLoad(srcMask,xy,0);
 for(var i=0u;i<u32(p.config.w);i++){
  let s=stamps[i];let d=(vec2f(xy)+.5-s.xy)/max(s.z,.5);var dist=length(d);if(p.config.y==4.){dist=max(abs(d.x),abs(d.y));}if(p.config.y==3.){dist=length(d*vec2f(.3,4.));}
  var alpha=(1.-smoothstep(min(p.config.x,.99),1.,dist))*s.w;
  if(p.config.y==1.){alpha*=smoothstep(.15,.8,hash(vec2f(xy)));}
  if(p.config.y==2.){alpha*=step(.77,hash(vec2f(xy)+s.xy))*.75;}
  if(alpha<.0001){continue;}
  if(p.config.z==1.){c.a*=1.-alpha;a.a*=1.-alpha;}
  else if(p.config.z>=2.){let target=select(1.,0.,p.config.z==3.);m=vec4f(vec3f(mix(m.r,target,alpha)),1.);}
  else{c=over(c,p.color.rgb,alpha);a=over(a,p.aux.rgb,alpha);}
 }
 textureStore(outColor,xy,c);textureStore(outAux,xy,a);textureStore(outMask,xy,m);
}
`;
export const compositeWGSL = noiseWGSL + /*wgsl*/ `
struct Params {options:vec4f,channels:vec4f,extra:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var baseColor:texture_2d<f32>;
@group(0) @binding(2) var baseAux:texture_2d<f32>;
@group(0) @binding(3) var layerColor:texture_2d<f32>;
@group(0) @binding(4) var layerAux:texture_2d<f32>;
@group(0) @binding(5) var layerMask:texture_2d<f32>;
@group(0) @binding(6) var geometry:texture_2d<f32>;
@group(0) @binding(7) var meshMaps:texture_2d<f32>;
@group(0) @binding(8) var outColor:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(9) var outAux:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
 let dim=textureDimensions(outColor);if(any(id.xy>=dim)){return;}
 let xy=vec2i(id.xy);let uv=(vec2f(id.xy)+.5)/vec2f(dim);var b=textureLoad(baseColor,xy,0);var ba=textureLoad(baseAux,xy,0);let l=textureLoad(layerColor,xy,0);let la=textureLoad(layerAux,xy,0);
 let gd=textureDimensions(geometry);let gxy=clamp(vec2i(uv*vec2f(gd)),vec2i(0),vec2i(gd)-1);let g=textureLoad(geometry,gxy,0);let mm=textureLoad(meshMaps,gxy,0);
 var mask=select(1.,textureLoad(layerMask,xy,0).r,p.options.z>.5);let gen=u32(p.options.w);let amount=p.extra.x;
 if(gen==1u){mask*=smoothstep(.5+amount*.18,.56+amount*.3,g.a);}
 if(gen==2u){mask*=1.-smoothstep(.28+amount*.22,.48+amount*.15,g.a);}
 if(gen==3u){let n=fbm(uv*8.);mask*=smoothstep(amount-.13,amount+.13,n+(.5-g.a)*.32);}
 if(gen==4u){mask*=(1.-mm.r)*smoothstep(amount-.25,amount+.2,fbm(uv*6.))+.25*(1.-mm.g);}
 if(gen==5u){mask*=smoothstep(amount-.06,amount+.06,fbm(uv*12.));}
 let opacity=clamp(l.a*p.options.x*mask,0.,1.);var c=pow(l.rgb,vec3f(2.2));let bc=pow(b.rgb,vec3f(2.2));let mode=u32(p.options.y);
 if(mode==1u){c*=bc;}else if(mode==2u){c=1.-(1.-c)*(1.-bc);}else if(mode==3u){c=select(2.*bc*c,1.-2.*(1.-bc)*(1.-c),bc>vec3f(.5));}else if(mode==4u){c=min(vec3f(1.),bc+c);}
 b=vec4f(pow(max(mix(bc,c,opacity*p.channels.x),vec3f(0)),vec3f(1./2.2)),1.);
 ba=vec4f(mix(ba.r,la.r,opacity*p.channels.y),mix(ba.g,la.g,opacity*p.channels.z),mix(ba.b,la.b,opacity*p.channels.w),mm.r);
 textureStore(outColor,xy,b);textureStore(outAux,xy,ba);
}
`;
export const normalWGSL = /*wgsl*/ `
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var dst:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let d=vec2i(textureDimensions(src));let p=vec2i(id.xy);if(any(p>=d)){return;}
 let l=textureLoad(src,clamp(p+vec2i(-1,0),vec2i(0),d-1),0).b;let r=textureLoad(src,clamp(p+vec2i(1,0),vec2i(0),d-1),0).b;
 let t=textureLoad(src,clamp(p+vec2i(0,-1),vec2i(0),d-1),0).b;let b=textureLoad(src,clamp(p+vec2i(0,1),vec2i(0),d-1),0).b;
 let n=normalize(vec3f((l-r)*4.,(b-t)*4.,1.));textureStore(dst,p,vec4f(n*.5+.5,1.));}
`;
