"""Generate only AEROTWIN-owned collections and export separate replaceable GLBs.

Usage: blender --background --python assets/blender/generate.py
Existing unrelated objects/collections are never deleted. Generated source .blend
contains native geometry in metres; browser receives native glTF Y-up, scale 1.
"""
import bpy,sys,json,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from common import begin_asset,export_asset
from aircraft import build_aircraft
from environment import build_terminal,build_bridge,build_apron,build_vehicles
ROOT=HERE.parent.parent
OUT=ROOT/'public/models/airport'
OUT.mkdir(parents=True,exist_ok=True)
bpy.context.scene.unit_settings.system='METRIC'
bpy.context.scene.unit_settings.scale_length=1
manifest={'version':'0.2.0','blender':bpy.app.version_string,'unit':'metre','browser_up':'+Y','nose':'+Z','port':'+X','assets':[]}

for name,build in [('aircraft',build_aircraft),('terminal',build_terminal),('bridge',build_bridge),('apron',build_apron),('vehicles',build_vehicles)]:
    col=begin_asset(name)
    root=build()
    if root:
        root['asset_version']='0.2.0'
        root['unit']='metre'
        root['browser_orientation']='X lateral / Y up / Z forward'
    # glTF supports mesh surfaces. Convert only our generated curves/fonts.
    for obj in list(col.objects):
        if obj.type in {'CURVE','FONT','SURFACE'}:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.convert(target='MESH')
    path=OUT/(name+'.glb')
    export_asset(col,path)
    manifest['assets'].append({'id':name,'file':name+'.glb','bytes':path.stat().st_size,'root':root.name if root else None,'objects':len(col.objects)})

bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'aerotwin-v0.2.blend'))
manifest['total_model_bytes']=sum(a['bytes'] for a in manifest['assets'])
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('AEROTWIN_EXPORT_COMPLETE',json.dumps(manifest))
