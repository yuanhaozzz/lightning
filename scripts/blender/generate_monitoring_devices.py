"""Two reusable GENERIC SCHEMATIC devices, not manufacturer replicas.
Y-up meter inputs; glTF Y-up outputs. No existing GLB is imported or exported.
Blender -b --factory-startup --python-exit-code 1 --python this_file
Optional -- --parameters file --output-dir directory.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_core_production as p

ROOT = Path(__file__).resolve().parents[2]
box, rod = p.box, p.rod

def protected():
    records = json.loads((ROOT/'scripts/blender/monitoring.protected-baseline.json').read_text(encoding='utf-8-sig'))
    for item in records:
        assert hashlib.sha256((ROOT/item['path']).read_bytes()).hexdigest().upper() == item['hash'], item['path']
    return len(records)

def materials():
    palette = {
        'concrete': ((.46,.48,.46),0,.90,'concrete'),
        'paint': ((.68,.71,.69),.25,.44,None),
        'steel': ((.32,.38,.40),.80,.36,None),
        'sensor': ((.78,.80,.76),0,.33,None),
        'dark': ((.045,.055,.057),.15,.7,None),
        'blue': ((.08,.25,.32),.35,.48,None),
        'amber': ((.73,.43,.12),.2,.50,None),
    }
    for name, values in palette.items():
        p.M[name] = p.primitives.material('Monitor_'+name, *values)

def bolts(x, y, z, spread=.16):
    for dx in (-spread, spread):
        for dz in (-spread, spread):
            rod('anchor_bolt',(x+dx,y,z+dz),(x+dx,y+.045,z+dz),.018,'steel',6)

def enclosure(y, width, height, depth, accent):
    # Back face meets mast-mounted brackets. Separate door seam, hinges and latch.
    z=.08+depth/2
    box('sealed_equipment_box',(0,y,z),(width,height,depth),'paint',.012)
    box('door_gasket',(0,y,z+depth/2+.002),(width-.045,height-.045,.009),'dark')
    box('service_door',(0,y,z+depth/2+.012),(width-.065,height-.065,.018),'paint',.008)
    for yy in (y-height*.30,y+height*.30):
        box('door_hinge',(-width/2+.026,yy,z+depth/2+.025),(.035,.065,.035),'steel')
        box('mast_bracket',(0,yy,.065),(.20,.045,.05),'steel')
        rod('mast_clamp',(0,yy-.018,0),(0,yy+.018,0),.095,'steel',24)
    box('door_lock',(width/2-.07,y,z+depth/2+.027),(.035,.07,.025),'dark',.004)
    box('generic_id_plate',(0,y-height*.29,z+depth/2+.026),(width*.48,.085,.012),'steel')
    box('type_marker',(0,y-height*.29,z+depth/2+.034),(width*.42,.028,.006),accent)
    for x in (-width*.22,width*.22):
        rod('cable_gland',(x,y-height/2-.045,z),(x,y-height/2+.008,z),.022,'dark',12)
    # External protected conduit connects box underside to the mast/base route.
    points=[(-width*.22,y-height/2-.04,z),(-width*.22,y-height/2-.12,z),(-.10,y-height/2-.12,.05),(-.10,.12,.05)]
    for a,b in zip(points,points[1:]):rod('protected_cable',a,b,.012,'dark',8)

def lathe(name, profile, x=0, z=0, mat='sensor', segments=32):
    vs=[(x+r*math.cos(j*math.tau/segments),y,z+r*math.sin(j*math.tau/segments)) for y,r in profile for j in range(segments)]
    fs=[tuple(reversed(range(segments)))]
    for k in range(len(profile)-1):
        fs += [(k*segments+j,k*segments+(j+1)%segments,(k+1)*segments+(j+1)%segments,(k+1)*segments+j) for j in range(segments)]
    fs.append(tuple(range((len(profile)-1)*segments,len(profile)*segments)))
    obj=p.mesh(name,vs,[tuple(reversed(face)) for face in fs],mat)
    for poly in obj.data.polygons:poly.use_smooth=len(poly.vertices)==4
    return obj

def locator(cfg):
    w,h,d=cfg['foundationSize']; top=cfg['mastTop']
    box('foundation',(0,h/2,0),(w,h,d),'concrete',.018)
    box('bolted_base_plate',(0,h+.018,0),(.44,.036,.44),'steel',.005)
    bolts(0,h+.036,0)
    rod('instrument_mast',(0,h+.035,0),(0,top,0),.073,'paint',32)
    rod('base_socket',(0,h+.036,0),(0,h+.19,0),.10,'steel',24)
    enclosure(1.65,.62,.78,.25,'blue')
    rod('sensor_neck',(0,top-.11,0),(0,top+.10,0),.085,'paint',24)
    rod('sensor_flange',(0,top+.07,0),(0,top+.10,0),.245,'steel',32)
    for j in range(6):
        a=j*math.tau/6
        rod('sensor_flange_bolt',(.22*math.cos(a),top+.1,.22*math.sin(a)),(.22*math.cos(a),top+.125,.22*math.sin(a)),.009,'steel',6)
    profile=[(top+.10,.185),(top+.32,.185)]
    profile += [(top+.32+.185*math.sin(a),max(.002,.185*math.cos(a))) for a in [j*math.pi/12 for j in range(1,7)]]
    lathe('opaque_generic_radome',profile)
    rod('sensor_lead',(-.075,2.04,.04),(-.075,top+.075,.04),.009,'dark',8)
    for y in (.7,1.1,2.35,2.8):
        box('conduit_clip',(-.087,y,.05),(.045,.025,.025),'steel')

def warning(cfg):
    w,h,d=cfg['foundationSize']; top=cfg['mastTop']
    box('foundation',(0,h/2,0),(w,h,d),'concrete',.018)
    rod('tripod_mast',(0,h+.025,0),(0,top,0),.048,'steel',24)
    rod('tripod_collar',(0,1.38,0),(0,1.51,0),.085,'steel',24)
    for j in range(3):
        a=math.pi/6+j*math.tau/3
        x,z=.97*math.cos(a),.97*math.sin(a)
        box('tripod_foot',(x,h+.02,z),(.26,.04,.26),'steel',.004)
        bolts(x,h+.04,z,.075)
        rod('tripod_leg',(x,h+.04,z),(.05*math.cos(a),1.46,.05*math.sin(a)),.032,'steel',16)
        t=(.63-(h+.04))/(1.46-(h+.04))
        rod('tripod_brace',(0,.63,0),((1-t)*x+t*.05*math.cos(a),.63,(1-t)*z+t*.05*math.sin(a)),.012,'steel',12)
    enclosure(1.62,.30,.40,.15,'amber')
    # Continuous bent tubular support; three mast clamps support its vertical leg.
    points=[(.07,1.95,0),(.07,top-.12,0)]
    points += [(-.31+.38*math.cos(a),top-.12+.38*math.sin(a),0) for a in [j*math.pi/16 for j in range(1,17)]]
    points.append((-.69,top-.15,0))
    for a,b in zip(points,points[1:]):rod('curved_sensor_arm',a,b,.033,'steel',16)
    for y in (2.0,2.27,2.53):
        box('arm_clamp',(0,y,0),(.18,.043,.10),'steel',.003)
        rod('clamp_bolt',(-.085,y,-.065),(-.085,y,.065),.011,'dark',6)
    rod('sensor_arm_terminal',(-.69,top-.20,0),(-.69,top-.08,0),.046,'dark',24)
    lathe('downward_sensor_housing',[(top-.43,.21),(top-.39,.235),(top-.19,.235),(top-.16,.19)],x=-.69,mat='steel')
    rod('sensor_face',(-.69,top-.449,0),(-.69,top-.43,0),.184,'dark',32)
    # Static sensing-aperture representation only; no claimed measurement algorithm.
    for j in range(6):
        a=j*math.tau/6
        rod('aperture_detail',(-.69+.13*math.cos(a),top-.455,.13*math.sin(a)),(-.69+.13*math.cos(a),top-.449,.13*math.sin(a)),.022,'sensor',12)
    rod('sensor_lead',(.1,1.82,.04),(.1,2.6,.04),.008,'dark',8)

def export(path, kind):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    lo=[min(v[i] for v in coords) for i in range(3)]; hi=[max(v[i] for v in coords) for i in range(3)]
    root=bpy.data.objects.new('schematic-'+kind,None);bpy.context.collection.objects.link(root)
    root['kind']='monitoring-device';root['deviceType']=kind;root['schematic']=True
    for obj in objects:
        if not obj.data.uv_layers:
            uv=obj.data.uv_layers.new(name='UVMap')
            for poly in obj.data.polygons:
                axis=max(range(3),key=lambda i:abs(poly.normal[i]));axes=[i for i in range(3) if i!=axis]
                for loop in poly.loop_indices:
                    v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                    uv.data[loop].uv=(v[axes[0]],v[axes[1]])
    for mat in p.M.values():
        members=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials[0]==mat]
        if not members:continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in members:obj.select_set(True)
        bpy.context.view_layer.objects.active=members[0]
        if len(members)>1:bpy.ops.object.join()
        bpy.context.object.name=kind+'__'+mat.name;bpy.context.object.parent=root
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    assert bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_extras=True,
        export_cameras=False,export_lights=False,export_animations=False)=={'FINISHED'}
    return {'type':kind,'file':path.name,'triangles':sum(len(poly.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for poly in o.data.polygons),
        'meshes':sum(o.type=='MESH' for o in bpy.context.scene.objects),'bytes':path.stat().st_size,
        'bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]}}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--parameters',default=str(Path(__file__).with_name('monitoring.parameters.json')))
    parser.add_argument('--output-dir',default=str(ROOT/'public/models'))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    cfg=json.loads(Path(args.parameters).read_text(encoding='utf-8-sig'));out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    protected();materials();outputs=[]
    for kind,build in [('lightning-locator',locator),('storm-warning',warning)]:
        p.reset();build(cfg['models'][kind]);result=export(out/cfg['models'][kind]['file'],kind)
        assert result['triangles']<cfg['maxTrianglesPerModel'];assert result['bytes']<cfg['maxBytesPerModel']
        assert abs(result['bounds']['min'][1])<.00001
        outputs.append(result)
    report={'schematic':True,'outputs':outputs,'protectedFilesUnchanged':protected(),
        'scope':'Generic demonstration only. No claimed geolocation/false-alarm performance or validated deployment.'}
    (out/'mine-monitoring.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('MONITORING_EXPORT_OK',json.dumps(report))

if __name__=='__main__':main()
