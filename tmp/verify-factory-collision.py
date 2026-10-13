"""Actual authored triangles checked at 17 finite skip positions."""
import sys,json
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
root=Path.cwd();cfg=json.loads((root/'public/models/mine-factory-animation.bindings.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'public/models/mine-headframe.glb'))
placement=Matrix.Translation(Vector((-15.96,6,.944)))@Matrix.Scale(1.6,4)
stationary=[]
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  stationary.append((o.name,BVHTree.FromPolygons([placement@o.matrix_world@v.co for v in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons])))
old=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(root/'public/models/mine-hoist-container.glb'))
objects=[o for o in set(bpy.context.scene.objects)-old if o.type=='MESH']
x=cfg['hoist']['containerAnchor'][0];results=[]
for i in range(17):
 bottom=.12+1.6*i/16;transform=Matrix.Translation(Vector((x,6,bottom)))
 for o in objects:
  tree=BVHTree.FromPolygons([transform@o.matrix_world@v.co for v in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons])
  for name,fixed in stationary:
   assert not tree.overlap(fixed),f'Skip collision at y={bottom}: {name}, {o.name}'
 results.append(bottom)
report={'result':'PASS','testedBottomPositionsMeters':results,'stationaryMeshes':len(stationary),'skipMeshes':len(objects),'method':'Actual triangle BVH overlap, retained headframe unchanged'}
(root/'tmp/factory-collision-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
