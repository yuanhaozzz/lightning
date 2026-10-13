"""Read-only support audit of existing GLBs. No model export or source edits."""
import bpy
import json
import hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
files=list((ROOT/'public/models').glob('*.glb'))
before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
trees=[]
for filename in ('mine-distribution-shell.glb','mine-distribution-roof.glb'):
    existing=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models'/filename))
    bpy.context.view_layer.update()
    for obj in set(bpy.context.scene.objects)-existing:
        if obj.type=='MESH':
            trees.append(BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],
                                             [tuple(p.vertices) for p in obj.data.polygons]))
gaps=[]
for x in (-4.6,-2.3,0,2.3,4.6):
    for z in (-2.26,-1.74,1.74,2.26):
        point=Vector((x,-z,3.88))
        nearest=min(tree.find_nearest(point)[3] for tree in trees)
        hits=[tree.ray_cast(point,Vector((0,0,1)),2)[3] for tree in trees]
        vertical=min((d for d in hits if d is not None),default=None)
        gaps.append({'hangerTopLocalYUp':[x,3.88,z],'nearestBuildingDistanceMeters':nearest,
                     'verticalGapToBuildingMeters':vertical})
after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
assert before==after
report={'modelsUnchanged':True,'glbHashes':before,'hangerSamples':gaps,
        'minimumHangerTopToBuildingMeters':min(g['nearestBuildingDistanceMeters'] for g in gaps),
        'maximumHangerTopToBuildingMeters':max(g['nearestBuildingDistanceMeters'] for g in gaps),
        'finding':'Existing cable-tray hanger tops are not connected to the roof/wall structural geometry. No models modified.'}
(ROOT/'tmp/mine-power-acceptance-support-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('READ_ONLY_POWER_AUDIT',json.dumps({k:v for k,v in report.items() if k not in ('glbHashes','hangerSamples')}))
