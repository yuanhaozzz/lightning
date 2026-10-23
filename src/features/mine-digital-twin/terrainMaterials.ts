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
    // Isotropic chipped fractures: height-periodic waves read as contour lines
    // when projected across a large hillside, even with domain warping.
    const seam=Math.pow(1-Math.abs(2*noise(x/16+mineral*.7,y/16+grain*.4,16)-1),8)
    height[y*side+x]=.48*mineral+.30*grain+.1*hash(x,y,side)-.11*seam
  }
  const color=new Uint8Array(side*side*4), detail=new Uint8Array(side*side*4)
  const at=(x:number,y:number)=>height[((y+side)%side)*side+(x+side)%side]!
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const h=at(x,y), i=(y*side+x)*4, mineral=noise(x/32,y/32,8)
    const nx=(at(x-1,y)-at(x+1,y))*1.1, ny=(at(x,y-1)-at(x,y+1))*1.1
    const length=Math.sqrt(nx*nx+ny*ny+1)
    const value=THREE.MathUtils.clamp(175+76*(h-.35),130,212)
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
  material.customProgramCacheKey=()=> 'valley-triplanar-pbr-v3'
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
        // Domain-warped ecological patches and exposed strata follow the same
        // height field; no extra meshes, tiling decals or changed road elevations.
        vec2 warp=vec2(terrainNoise(q*.006+3.7),terrainNoise(q*.007-6.1))-.5;
        vec2 land=q+warp*34.0;
        float broad=terrainNoise(land*.010+3.7), surfacePatch=terrainNoise(land*.047-5.1);
        float granules=terrainNoise(land*.17+vTerrain.y*.025);
        float slope=1.0-abs(terrainN.y);
        float aspect=dot(terrainN,normalize(vec3(-.6,.15,-.7)))*.5+.5;
        float exposure=smoothstep(.055,.31,slope);
        float rock=exposure*(.42+.58*smoothstep(.25,.72,surfacePatch));
        float vegetation=smoothstep(.20,.55,broad*.48+surfacePatch*.30+aspect*.12+granules*.10)*(1.0-rock)*.97;
        float distanceToSite=length(max(abs(q)-vec2(74,57),vec2(0)));
        float skirt=1.0-smoothstep(3.0,22.0+12.0*surfacePatch,distanceToSite);
        float strata=terrainNoise(vec2(land.x*.068+vTerrain.y*.035,land.y*.079-vTerrain.y*.041)+warp*3.0);
        float erosion=pow(1.0-abs(terrainNoise(vec2(land.x*.045,land.y*.094)+warp*2.0)*2.0-1.0),5.0)*exposure;
        vec3 soil=mix(vec3(.175,.142,.094),vec3(.265,.229,.165),granules);
        vec3 stone=mix(vec3(.135,.156,.163),vec3(.295,.274,.221),smoothstep(.22,.76,strata));
        vec3 green=mix(vec3(.038,.071,.021),vec3(.129,.174,.068),surfacePatch*.55+granules*.45);
        vec3 surface=mix(mix(soil,green,vegetation),stone,rock);
        surface*=(1.0-erosion*.23)*(.82+.35*granules);
        // Gravel apron blends into the protected industrial slab, instead of a
        // uniformly coloured rectangular moat around the park.
        surface=mix(surface,mix(vec3(.255,.255,.228),vec3(.33,.325,.28),surfacePatch),skirt*.86);
        vec3 mineral=terrainSample(uMineralColor,vTerrain/12.0,terrainW).rgb;
        vec3 macroMineral=terrainSample(uMineralColor,vTerrain/37.0+vec3(.27),terrainW).rgb;
        vec4 terrainDetail=terrainSample(uMineralDetail,vTerrain/12.0,terrainW);
        float detailFade=1.0-smoothstep(.9,4.0,length(fwidth(q)));
        diffuseColor.rgb=surface*(.91+.20*surfacePatch)*mix(vec3(1),mineral*1.55,detailFade*.78)*mix(vec3(.94),macroMineral*1.6,.31);
        diffuseColor.rgb*=mix(1.0,terrainDetail.a,.4*detailFade)*.68;`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(mix(.96,terrainDetail.b,.8*detailFade)-rock*.08,.72,1.0);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 mineralNormal=terrainNormal(vTerrain/12.0,terrainN,terrainW);
        normal=normalize(mix(normal,mat3(viewMatrix)*mineralNormal,(.19+.14*rock)*detailFade));`)
  }
  return {material,textures:[albedo,packed],textureBytes:side*side*4*2*4/3}
}
