"""Execute existing generator in memory, with no GLB/source/model writes."""
import sys, json, math
from pathlib import Path
import bpy
sys.dont_write_bytecode = True
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'scripts/blender'))
import generate_mine_headframe as headframe
source=[]
original=headframe.finish
def record(obj,name,mat):
    source.append({'name':name,'material':mat.name,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons)})
    return original(obj,name,mat)
headframe.finish=record
stats=headframe.build()
families={}
for obj in source:
    name=obj['name']
    family=('grating_and_treads' if any(t in name for t in ['grate','Tread_','landing','Access_bridge']) else
            'wheel_and_bearings' if any(t in name for t in ['Hoist_','Hub_','Axle_','Bearing_','Wheel_support','Rope_contact']) else
            'guardrails' if any(t in name for t in ['guard','rail','Top_west','Top_east','Top_north','Top_south']) else
            'main_members_and_connections')
    item=families.setdefault(family,{'objects':0,'triangles':0})
    item['objects']+=1;item['triangles']+=obj['triangles']
result={'result':'PASS','blenderVersion':bpy.app.version_string,'operation':'Existing generator build() and collision assertions in memory; no GLB export', 'stats':stats,'sourceFamilyApproximateCounts':families,'sourceObjects':source,
        'flatShadingAfterJoin':{obj.name:{'faces':len(obj.data.polygons),'flatFaces':sum(not p.use_smooth for p in obj.data.polygons)} for obj in bpy.context.scene.objects}}
(root/'tmp/mine-quality-blender-audit.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print('HEADFRAME_READ_ONLY_AUDIT_OK '+json.dumps({k:v for k,v in result.items() if k not in ['sourceObjects','flatShadingAfterJoin']}))
