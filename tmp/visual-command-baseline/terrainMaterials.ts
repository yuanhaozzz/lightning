import * as THREE from 'three'

/** Deterministic, tileable mineral surface. RGB albedo and packed normal XY,
 * roughness, AO share two 256² textures; no downloads or texture-per-hill. */
export function createTerrainMaterial() {
  const side = 256, height = new Float32Array(side * side)
  const hash = (x: number, y: number, period: number) => {
    const n = Math.sin(((x % period + period) % period) * 127.1 + ((y % period + period) % period) * 311.7) * 43758.5453
    return n - Math.floor(n)
  }
  const noise = (x: number, y: number, period: number) => {
    const i = Math.floor(x), j = Math.floor(y), a = x-i, b=y-j
    const u=a*a*(3-2*a), v=b*b*(3-2*b)
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(i,j,period),hash(i+1,j,period),u),
      THREE.MathUtils.lerp(hash(i,j+1,period),hash(i+1,j+1,period),u),v)
  }
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const grain=noise(x/8,y/8,32), mineral=noise(x/32,y/32,8)
    // Meandering seams and chipped grains, seamlessly periodic at tile edges.
    const seam=Math.pow(Math.abs(Math.sin((y/side*8+noise(x/64,y/64,4)*.9)*Math.PI)),18)
    height[y*side+x]=.48*mineral+.27*grain+.1*hash(x,y,side)-.15*seam
  }
  const color=new Uint8Array(side*side*4), detail=new Uint8Array(side*side*4)
  const at=(x:number,y:number)=>height[((y+side)%side)*side+(x+side)%side]!
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const h=at(x,y), i=(y*side+x)*4, mineral=noise(x/32,y/32,8)
    const nx=(at(x-1,y)-at(x+1,y))*1.1, ny=(at(x,y-1)-at(x,y+1))*1.1
    const length=Math.sqrt(nx*nx+ny*ny+1)
    const value=THREE.MathUtils.clamp(178+53*(h-.35),140,212)
    color.set([value+5*mineral,value+2*mineral,value-6*mineral,255],i)
    detail.set([128+127*nx/length,128+127*ny/length,212+27*mineral,229+26*h],i)
  }
  const texture=(pixels:Uint8Array,colorSpace:typeof THREE.SRGBColorSpace|typeof THREE.NoColorSpace)=>{
    const map=new THREE.DataTexture(pixels,side,side,THREE.RGBAFormat)
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.minFilter=THREE.LinearMipmapLinearFilter
    map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;map.anisotropy=4
    map.colorSpace=colorSpace;map.needsUpdate=true;return map
  }
  const albedo=texture(color,THREE.SRGBColorSpace), packed=texture(detail,THREE.NoColorSpace)
  const material=new THREE.MeshStandardMaterial({roughness:.96,metalness:0})
  material.name='valley-mineral-soil-PBR'
  material.customProgramCacheKey=()=> 'valley-triplanar-pbr-v1'
  material.onBeforeCompile=shader=>{
    shader.uniforms.uMineralColor={value:albedo};shader.uniforms.uMineralDetail={value:packed}
    shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTerrain;varying vec3 vTerrainNormal;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvTerrain=position;vTerrainNormal=normal;')
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vTerrain; varying vec3 vTerrainNormal;
      uniform sampler2D uMineralColor; uniform sampler2D uMineralDetail;
      float terrainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float terrainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(terrainHash(i),terrainHash(i+vec2(1,0)),f.x),mix(terrainHash(i+vec2(0,1)),terrainHash(i+vec2(1)),f.x),f.y);}
      vec3 terrainWeights(vec3 n){vec3 w=pow(abs(n),vec3(4));return w/max(dot(w,vec3(1)),.0001);}
      vec4 terrainSample(sampler2D tex,vec3 p,vec3 w){return texture2D(tex,p.zy)*w.x+texture2D(tex,p.xz)*w.y+texture2D(tex,p.xy)*w.z;}
      vec3 terrainNormal(vec3 p,vec3 n,vec3 w){
        vec2 dx=texture2D(uMineralDetail,p.zy).rg*2.0-1.0;
        vec2 dy=texture2D(uMineralDetail,p.xz).rg*2.0-1.0;
        vec2 dz=texture2D(uMineralDetail,p.xy).rg*2.0-1.0;
        vec3 sx=vec3(sign(n.x)*sqrt(max(.01,1.0-dot(dx,dx))),dx.y,dx.x);
        vec3 sy=vec3(dy.x,sign(n.y)*sqrt(max(.01,1.0-dot(dy,dy))),dy.y);
        vec3 sz=vec3(dz.x,dz.y,sign(n.z)*sqrt(max(.01,1.0-dot(dz,dz))));
        return normalize(sx*w.x+sy*w.y+sz*w.z);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 terrainN=normalize(vTerrainNormal), terrainW=terrainWeights(terrainN);
        vec2 q=vTerrain.xz;
        float broad=terrainNoise(q*.009+3.7), surfacePatch=terrainNoise(q*.042-5.1);
        float slope=1.0-abs(terrainN.y);
        float rock=smoothstep(.10,.38,slope)*(.55+.45*surfacePatch);
        float vegetation=smoothstep(.22,.55,broad*.65+surfacePatch*.35)*(1.0-rock)*.93;
        float distanceToSite=length(max(abs(q)-vec2(74,57),vec2(0)));
        float skirt=1.0-smoothstep(5.0,25.0+12.0*surfacePatch,distanceToSite);
        float strata=.5+.5*sin(vTerrain.y*.65+terrainNoise(q*.04)*4.0);
        vec3 soil=vec3(.265,.227,.172), stone=mix(vec3(.22,.235,.23),vec3(.34,.32,.265),strata*.45);
        vec3 green=mix(vec3(.10,.16,.075),vec3(.20,.235,.12),surfacePatch);
        vec3 surface=mix(mix(soil,green,vegetation),stone,rock);
        surface=mix(surface,vec3(.30,.295,.265),skirt*.8);
        vec3 mineral=terrainSample(uMineralColor,vTerrain/12.0,terrainW).rgb;
        vec3 macroMineral=terrainSample(uMineralColor,vTerrain/37.0+vec3(.27),terrainW).rgb;
        vec4 terrainDetail=terrainSample(uMineralDetail,vTerrain/12.0,terrainW);
        float detailFade=1.0-smoothstep(.9,4.0,length(fwidth(q)));
        diffuseColor.rgb=surface*(.90+.17*surfacePatch)*mix(vec3(1),mineral*1.55,detailFade*.7)*mix(vec3(.94),macroMineral*1.6,.23);
        diffuseColor.rgb*=mix(1.0,terrainDetail.a,.4*detailFade);`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(mix(.96,terrainDetail.b,.8*detailFade)-rock*.08,.72,1.0);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 mineralNormal=terrainNormal(vTerrain/12.0,terrainN,terrainW);
        normal=normalize(mix(normal,mat3(viewMatrix)*mineralNormal,.22*detailFade));`)
  }
  return {material,textures:[albedo,packed],textureBytes:side*side*4*2*4/3}
}
