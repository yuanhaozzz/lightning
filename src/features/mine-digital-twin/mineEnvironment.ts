import * as THREE from 'three'
import { buildValleySurface } from './valleyTerrain'
import { drapeValleyRoads } from './valleyRoadSurface'
import { createTerrainMaterial } from './terrainMaterials'

/** Cheap, continuous surroundings. The rectangular hole leaves every existing
 * park surface (including the underground inspection window) untouched. */
export function createMineEnvironment(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'mine-natural-surroundings'
  const oldFog = scene.fog
  // Keep the industrial foreground clear; aerial perspective separates the
  // existing foothills and distant ridges without a blue overlay on buildings.
  const fog = new THREE.Fog('#8da7b7', 260, 1950); scene.fog = fog
  const skyGeometry = new THREE.SphereGeometry(1, 24, 12)
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uStorm: { value: 0 } },
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position; vec4 p=projectionMatrix*viewMatrix*vec4(cameraPosition+position*3000.0,1.0); gl_Position=p.xyww;}`,
    fragmentShader: `varying vec3 vDirection; uniform float uStorm;
      void main(){vec3 direction=normalize(vDirection);float h=direction.y;
        vec3 horizon=mix(vec3(.30,.42,.50),vec3(.30,.36,.40),uStorm*.50);
        vec3 zenith=mix(vec3(.075,.19,.31),vec3(.17,.25,.31),uStorm*.62);
        vec3 c=mix(horizon,zenith,smoothstep(-.02,.68,h));
        float sunFacing=max(0.0,dot(direction,normalize(vec3(-.40,.80,.55))));
        float aureole=pow(sunFacing,12.0)*.15+pow(sunFacing,80.0)*.06;
        c+=vec3(1.0,.73,.43)*aureole*(1.0-uStorm*.85)*smoothstep(0.0,.16,h);
        c=mix(horizon,c,smoothstep(-.12,.025,h));
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
  const terrainSurface=createTerrainMaterial()
  const groundMaterial=terrainSurface.material
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
    const material=new THREE.MeshStandardMaterial({color:['#95988a','#65706d','#d7d1b1'][i],roughness:.95,side:THREE.DoubleSide})
    const road=new THREE.Mesh(geometry,material);road.name=['approach-road-shoulders','approach-road-asphalt','approach-road-markings'][i]!
    road.raycast=()=>{};road.receiveShadow=true;root.add(road);roadResources.push(geometry);roadMaterials.push(material)
  }
  const normalFog=new THREE.Color('#8da7b7'), stormFog=new THREE.Color('#8297a3')
  let disposed=false
  return {
    resourceInfo:{drawCalls:6,terrainTriangles:indices.length/3,terrainVertices:positions.length/3,roadTriangles:roadBuffers.reduce((sum,b)=>sum+b.length/9,0),textures:terrainSurface.textures.length,textureBytes:terrainSurface.textureBytes,
      lod:'stitched near/middle/far distance-adaptive rings',nearSamples:rings[0]!.samples,farSamples:rings.at(-1)!.samples},
    update(opacity:number,position:readonly number[],earthInspection:boolean,approach=0){
      skyMaterial.uniforms.uStorm!.value=opacity
      fog.color.copy(normalFog).lerp(stormFog,opacity*.5)
      shadeMaterial.uniforms.uStrength!.value=opacity*(.10+.10*approach)
      shadeMaterial.uniforms.uCenter!.value.set(position[0]!+22,position[2]!+95)
      shade.visible=opacity>.001&&!earthInspection
    },
    dispose(){if(disposed)return;disposed=true;scene.remove(root);scene.fog=oldFog
      skyGeometry.dispose();skyMaterial.dispose();groundGeometry.dispose();groundMaterial.dispose();terrainSurface.textures.forEach(texture=>texture.dispose());shadeGeometry.dispose();shadeMaterial.dispose()
      roadResources.forEach(resource=>resource.dispose());roadMaterials.forEach(resource=>resource.dispose())},
  }
}
