import * as THREE from 'three'
import { buildValleySurface } from './valleyTerrain'
import { drapeValleyRoads } from './valleyRoadSurface'

/** Cheap, continuous surroundings. The rectangular hole leaves every existing
 * park surface (including the underground inspection window) untouched. */
export function createMineEnvironment(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'mine-natural-surroundings'
  const oldFog = scene.fog
  const fog = new THREE.Fog('#cfd5d4', 400, 2200); scene.fog = fog
  const skyGeometry = new THREE.SphereGeometry(1, 24, 12)
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uStorm: { value: 0 } },
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position; vec4 p=projectionMatrix*viewMatrix*vec4(cameraPosition+position*3000.0,1.0); gl_Position=p.xyww;}`,
    fragmentShader: `varying vec3 vDirection; uniform float uStorm;
      void main(){float h=normalize(vDirection).y;
        vec3 horizon=mix(vec3(.62,.66,.65),vec3(.51,.56,.56),uStorm*.45);
        vec3 zenith=mix(vec3(.36,.52,.65),vec3(.38,.46,.50),uStorm*.55);
        vec3 c=mix(horizon,zenith,smoothstep(0.0,.55,h));
        c=mix(vec3(.62,.66,.65),c,smoothstep(-.16,0.0,h));
        gl_FragColor=vec4(c,1.0);
        #include <colorspace_fragment>
      }`,
  })
  const sky = new THREE.Mesh(skyGeometry, skyMaterial)
  sky.frustumCulled = false; sky.renderOrder = -1000; sky.raycast = () => {}
  root.add(sky)
  const {positions,indices,rings}=buildValleySurface()
  const groundGeometry=new THREE.BufferGeometry()
  groundGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  groundGeometry.setIndex(indices);groundGeometry.computeVertexNormals()
  const groundMaterial=new THREE.MeshStandardMaterial({roughness:1,metalness:0})
  groundMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vTerrain;varying float vSlope;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvTerrain=position;vSlope=1.0-abs(normal.y);')
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vTerrain;varying float vSlope;
      float terrainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float terrainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(terrainHash(i),terrainHash(i+vec2(1,0)),f.x),mix(terrainHash(i+vec2(0,1)),terrainHash(i+vec2(1)),f.x),f.y);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 q=vTerrain.xz;
        float broad=terrainNoise(q*.007+3.7),surfacePatch=terrainNoise(q*.038-5.1);
        float rock=smoothstep(.09,.32,vSlope)*(.55+.45*broad);
        float vegetation=smoothstep(.26,.58,broad*.65+surfacePatch*.35)*(1.0-rock)*.85;
        float skirt=1.0-smoothstep(8.0,35.0,length(max(abs(q)-vec2(74,57),vec2(0))));
        vec3 soil=vec3(.235,.235,.215),stone=vec3(.27,.29,.28),green=vec3(.085,.15,.075);
        vec3 surface=mix(mix(soil,green,vegetation),stone,rock);
        surface=mix(surface,vec3(.32,.33,.315),skirt*.65);
        float grain=terrainNoise(q*4.8+terrainNoise(q*.07)*3.0)-.5;
        float detailFade=1.0-smoothstep(.6,2.5,length(fwidth(q)));
        diffuseColor.rgb=surface*(.86+.22*surfacePatch+.07*grain*detailFade);`)
  }
  const ground=new THREE.Mesh(groundGeometry,groundMaterial)
  ground.name='valley-height-field';ground.receiveShadow=true;ground.raycast=()=>{};root.add(ground)
  // One soft non-directional cloud shade, not an extra transparent particle layer.
  const shadeGeometry=new THREE.PlaneGeometry(900,800)
  const shadeMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
    uniforms:{uStrength:{value:0},uCenter:{value:new THREE.Vector2()}},
    vertexShader:`varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`varying vec3 vWorld;uniform float uStrength;uniform vec2 uCenter;
      void main(){if(abs(vWorld.x+14.248)<1.36&&abs(vWorld.z+6.0)<1.36)discard;
        vec2 q=(vWorld.xz-uCenter)/vec2(160.0,115.0);
        float a=exp(-dot(q,q)*1.7)*uStrength;
        if(a<.001)discard;gl_FragColor=vec4(.13,.17,.20,a);}`,
  })
  const shade=new THREE.Mesh(shadeGeometry,shadeMaterial)
  shade.rotation.x=-Math.PI/2;shade.position.y=.14;shade.renderOrder=19;shade.raycast=()=>{}
  root.add(shade);scene.add(root)
  // Only extend the two existing gates into the surrounding landscape. Sample
  // the rendered terrain, not an unrelated height formula, so roads stay grounded.
  const roadBuffers=drapeValleyRoads({positions,indices})
  const roadResources:THREE.BufferGeometry[]=[],roadMaterials:THREE.Material[]=[]
  for(let i=0;i<3;i++){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(roadBuffers[i]!,3));geometry.computeVertexNormals()
    const material=new THREE.MeshStandardMaterial({color:['#9c9e93','#737b7b','#dad4b2'][i],roughness:.95,side:THREE.DoubleSide})
    const road=new THREE.Mesh(geometry,material);road.name=['approach-road-shoulders','approach-road-asphalt','approach-road-markings'][i]!
    road.raycast=()=>{};road.receiveShadow=true;root.add(road);roadResources.push(geometry);roadMaterials.push(material)
  }
  const normalFog=new THREE.Color('#cfd5d4'), stormFog=new THREE.Color('#bdc6c7')
  let disposed=false
  return {
    resourceInfo:{drawCalls:6,terrainTriangles:indices.length/3,terrainVertices:positions.length/3,roadTriangles:roadBuffers.reduce((sum,b)=>sum+b.length/9,0),textures:0,
      lod:'stitched near/middle/far distance-adaptive rings',nearSamples:rings[0]!.samples,farSamples:rings.at(-1)!.samples},
    update(opacity:number,position:readonly number[],earthInspection:boolean,approach=0){
      skyMaterial.uniforms.uStorm!.value=opacity
      fog.color.copy(normalFog).lerp(stormFog,opacity*.5)
      shadeMaterial.uniforms.uStrength!.value=opacity*(.10+.10*approach)
      shadeMaterial.uniforms.uCenter!.value.set(position[0]!+22,position[2]!+95)
      shade.visible=opacity>.001&&!earthInspection
    },
    dispose(){if(disposed)return;disposed=true;scene.remove(root);scene.fog=oldFog
      skyGeometry.dispose();skyMaterial.dispose();groundGeometry.dispose();groundMaterial.dispose();shadeGeometry.dispose();shadeMaterial.dispose()
      roadResources.forEach(resource=>resource.dispose());roadMaterials.forEach(resource=>resource.dispose())},
  }
}
