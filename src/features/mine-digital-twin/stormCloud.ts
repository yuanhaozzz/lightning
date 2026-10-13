import * as THREE from 'three'
import { CLOUD_GRID, generateCloudDensity, bakeCloudLighting, densitySilhouette, densityBounds } from './stormCloudDensity'
import { CLOUD_SIZE, CLOUD_FROM, CLOUD_TO, createCloudMotion, type CloudClock } from './stormCloudState'
import { stormAtmosphereAt } from './stormAtmosphereState'

const vertexShader = `
out vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const fragmentShader = `
precision highp sampler3D;
uniform sampler3D uDensity;
uniform vec3 uCamera;
uniform mat4 uClip;
uniform float uOpacity;
uniform float uBaseLight;
uniform float uFlash;
uniform vec3 uFlashPosition;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
in vec3 vLocal;
out vec4 outColor;
#define gl_FragColor outColor
void main() {
  vec3 rd = normalize(vLocal - uCamera);
  vec3 inv = 1.0 / (rd + vec3(0.000001));
  vec3 a = (uBoundsMin - uCamera) * inv;
  vec3 b = (uBoundsMax - uCamera) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  float entry = max(max(lo.x, lo.y), lo.z);
  float leave = min(min(hi.x, hi.y), hi.z);
  entry = max(entry, 0.0);
  if (leave <= entry || uOpacity < 0.0001) discard;
  float dt = (leave - entry) / 48.0;
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  vec3 first = uCamera + rd * leave;
  bool found = false;
  // Stable spatial dithering breaks coherent marching contours. No time/frame
  // seed is used: paused clouds stay pixel-stable and motion remains continuous.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 48; i++) {
    vec3 p = uCamera + rd * (entry + (float(i) + jitter) * dt);
    vec3 uvw = p + vec3(0.5);
    vec2 field = texture(uDensity, uvw).rg;
    float density = field.r;
    if (density < 0.015) continue;
    if (!found && density > 0.04) { first = p; found = true; }
    float illumination = 0.32 + 0.68 * field.g;
    vec3 shade = mix(vec3(0.16, 0.20, 0.245), vec3(0.87, 0.89, 0.91), smoothstep(0.08, 0.66, uvw.y));
    shade *= mix(uBaseLight,1.0,smoothstep(.12,.55,uvw.y));
    vec3 flashDistance=(uvw-uFlashPosition)*vec3(3.3,2.8,3.8);
    float flashGlow=exp(-dot(flashDistance,flashDistance)*4.0)*uFlash;
    float opacity = 1.0 - exp(-density * dt * 21.0);
    color += (1.0 - alpha) * opacity * (shade * illumination + vec3(.88,.91,.94)*flashGlow*1.9);
    alpha += (1.0 - alpha) * opacity;
    if (alpha > 0.975) break;
  }
  if (alpha < 0.003 || !found) discard;
  // Test the first occupied volume sample against opaque scene depth rather than
  // the box's back face. Cloud never writes depth and does not hide pick targets.
  vec4 clip = uClip * vec4(first, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
  outColor = vec4(color / max(alpha, 0.001), alpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function createStormCloud(scene: THREE.Scene, lights: { sun: THREE.DirectionalLight; ambient: THREE.HemisphereLight }) {
  const motion = createCloudMotion()
  const data = generateCloudDensity()
  const field = bakeCloudLighting(data)
  const silhouette = densitySilhouette(data)
  const bounds=densityBounds(data)
  const lower=new THREE.Vector3(...bounds.min),upper=new THREE.Vector3(...bounds.max)
  const density = new THREE.Data3DTexture(field, CLOUD_GRID.width, CLOUD_GRID.height, CLOUD_GRID.depth)
  density.format = THREE.RGFormat
  density.type = THREE.UnsignedByteType
  density.minFilter = density.magFilter = THREE.LinearFilter
  density.unpackAlignment = 1
  density.needsUpdate = true
  const extent=upper.clone().sub(lower),center=upper.clone().add(lower).multiplyScalar(.5)
  const geometry = new THREE.BoxGeometry(extent.x,extent.y,extent.z).translate(center.x,center.y,center.z)
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader,
    uniforms: { uDensity: { value: density }, uCamera: { value: new THREE.Vector3() }, uClip: { value: new THREE.Matrix4() }, uOpacity: { value: 0 },uBoundsMin:{value:lower},uBoundsMax:{value:upper},
      uBaseLight:{value:1},uFlash:{value:0},uFlashPosition:{value:new THREE.Vector3()} },
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'demo-storm-volume'
  mesh.scale.set(...CLOUD_SIZE)
  mesh.visible = false
  mesh.renderOrder = 20
  mesh.raycast = () => {} // Presentation only; also outside the semantic park root.
  const inverse = new THREE.Matrix4()
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(mesh.matrixWorld).invert()
    material.uniforms.uCamera!.value.copy(camera.position).applyMatrix4(inverse)
    material.uniforms.uClip!.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld)
  }
  scene.add(mesh)
  const baseline = { sun: lights.sun.intensity, ambient: lights.ambient.intensity,
    environment: scene.environmentIntensity, background: scene.background instanceof THREE.Color ? scene.background.clone() : null }
  const cloudyBackground = new THREE.Color('#c5cdd0')
  let disposed = false
  let atmosphere=stormAtmosphereAt({phase:'normal',playback:'idle',elapsedMs:0,runId:null,durationMs:45000})
  let previousAtmosphere=''
  return {
    get frame() { return motion.frame },
    get atmosphere(){return {...atmosphere,flashPosition:[...atmosphere.flashPosition]}},
    framingPoints() {
      return [CLOUD_FROM,CLOUD_TO].flatMap(center => silhouette.map(point => new THREE.Vector3(
        center[0]+point[0]*CLOUD_SIZE[0],center[1]+point[1]*CLOUD_SIZE[1],center[2]+point[2]*CLOUD_SIZE[2])))
    },
    overviewPoints() {
      if (!mesh.visible) return []
      const half = new THREE.Vector3(...CLOUD_SIZE).multiplyScalar(.5)
      return [-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z =>
        new THREE.Vector3(half.x*x, half.y*y, half.z*z).add(mesh.position))))
    },
    get resourceInfo() { return { drawCalls: 1, triangles: 12, maxRaySteps: 48, densityBytes: field.byteLength, textures: 1, materials: 1 } },
    update(clock: CloudClock, deltaMs: number) {
      if (disposed) return false
      const changed = motion.update(clock, deltaMs)
      const frame = motion.frame
      atmosphere=stormAtmosphereAt(clock)
      mesh.position.set(...frame.position)
      mesh.visible = frame.visible
      material.uniforms.uOpacity!.value = frame.opacity
      material.uniforms.uBaseLight!.value=atmosphere.baseLight
      material.uniforms.uFlash!.value=atmosphere.flash*frame.opacity
      material.uniforms.uFlashPosition!.value.set(...atmosphere.flashPosition)
      lights.sun.intensity = baseline.sun * (1 - (.14+.08*atmosphere.approach) * frame.opacity)
      lights.ambient.intensity = baseline.ambient * (1 - (.06+.06*atmosphere.approach) * frame.opacity)
      scene.environmentIntensity = baseline.environment * (1 - .18 * frame.opacity)
      if (baseline.background && scene.background instanceof THREE.Color) scene.background.copy(baseline.background).lerp(cloudyBackground, frame.opacity * .45)
      const next=JSON.stringify(atmosphere),visualChanged=next!==previousAtmosphere
      previousAtmosphere=next
      return changed||visualChanged
    },
    dispose() {
      if (disposed) return
      disposed = true; scene.remove(mesh)
      lights.sun.intensity = baseline.sun; lights.ambient.intensity = baseline.ambient
      scene.environmentIntensity = baseline.environment
      if (baseline.background && scene.background instanceof THREE.Color) scene.background.copy(baseline.background)
      geometry.dispose(); material.dispose(); density.dispose()
    },
  }
}
