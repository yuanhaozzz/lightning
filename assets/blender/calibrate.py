"""Run first. Export one 1 m cube, RGB positive axes and a shadow receiver."""
import bpy, sys, json
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from common import *
ROOT=HERE.parent.parent
out=ROOT/'public/models/airport'
out.mkdir(parents=True,exist_ok=True)
collection=begin_asset('calibration')
bpy.context.scene.unit_settings.system='METRIC'
bpy.context.scene.unit_settings.scale_length=1
root=empty('AT_Calibration_Root')
root['asset_version']='0.1.0'
root['units']='metres'
root['browser_axes']='X lateral, Y up, Z forward'
box('Calibration_1m_Cube',(0,.5,0),(1,1,1),material('test_paint',(.65,.72,.8),.15,.35),root)
box('Calibration_Ground',(0,-.05,0),(8,.1,8),material('test_concrete',(.46,.47,.48),0,.9),root)
for axis,end,color in [('X',(2,.015,0),(1,.06,.03)),('Y',(0,2,0),(.05,.8,.1)),('Z',(0,.015,2),(.05,.2,1))]:
    cylinder('Positive_'+axis,(0,.015,0),end,.025,material('Axis_'+axis,color),root)
export_asset(collection,out/'calibration.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'calibration.blend'))
(out/'calibration.json').write_text(json.dumps({'blender':bpy.app.version_string,'cube_m':[1,1,1],'gltf_up':'+Y','method':'Blender export_yup=True; no browser correction'},indent=2))
