"""Generic protection facilities only. Existing GLBs are read for roof/support
checks, never modified. No claimed IEC compliance, coverage or monitor accuracy.
Meters, Y-up input. Blender -b --factory-startup --python-exit-code 1 --python this_file.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0,str(Path(__file__).resolve().parent))
import generate_core_production as p
ROOT=Path(__file__).resolve().parents[2]
box,rod,beam=p.box,p.rod,p.beam
ROOF_TREES={}
ROUTES=[]
SUPPORTS=[]
CHECKS=[]

def protected():
    items=json.loads((ROOT/'scripts/blender/protection.protected-baseline.json').read_text(encoding='utf-8-sig'))
    for item in items:assert hashlib.sha256((ROOT/item['path']).read_bytes()).hexdigest().upper()==item['hash'],item['path']
    return len(items)

def materials():
    palette={
        'concrete':((.46,.48,.46),0,.90,'concrete'),
        'metal':((.38,.44,.46),.82,.34,None),
        'paint':((.64,.67,.62),.2,.53,None),
        'copper':((.46,.25,.13),.78,.38,None),
        'dark':((.045,.054,.055),.15,.72,None),
        'red':((.48,.12,.085),.1,.57,None),
        'green':((.11,.36,.19),.1,.51,None),
        'yellow':((.70,.51,.11),.1,.55,None),
        'soil':((.37,.31,.22),0,1,None),
    }
    for key,values in palette.items():p.M[key]=p.primitives.material('Protection_'+key,*values)

def roof_trees(cfg):
    for key,roof in cfg['roofs'].items():
        p.reset();bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models'/roof['model']))
        bpy.context.view_layer.update()
        ROOF_TREES[key]=[BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],
            [tuple(face.vertices) for face in o.data.polygons]) for o in bpy.context.scene.objects if o.type=='MESH']

def surface(key,x,z):
    hits=[tree.ray_cast(p.xyz((x,20,z)),p.xyz((0,-1,0))) for tree in ROOF_TREES[key]]
    ys=[hit[0].z for hit in hits if hit[0] is not None]
    assert ys,f'No roof support at {key}: {x}, {z}'
    return max(ys)

def roof_y(cfg,z):
    return cfg['size'][1]-(cfg['size'][1]-cfg['eaves'])*abs(z)/(cfg['size'][2]/2+.22)+.15

def route(name,points,mat='metal',radius=.018,roof_key=None):
    for a,b in zip(points,points[1:]):rod(name,a,b,radius,mat,12)
    ROUTES.append({'name':name,'points':points,'radius':radius,'roof':roof_key})
    if roof_key:
        minimum=100
        for a,b in zip(points,points[1:]):
            a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.10))
            for i in range(n+1):
                point=p.xyz(a.lerp(b,i/n))
                minimum=min(minimum,min(tree.find_nearest(point)[3] for tree in ROOF_TREES[roof_key])-radius)
        assert minimum>.04,(name,minimum)
        CHECKS.append({'route':name,'roof':roof_key,'surfaceClearanceMeters':minimum})

def roof_support(key,point):
    x,y,z=point;bottom=surface(key,x,z)
    assert y-.018>bottom
    box('roof_fastener',(x,bottom+.008,z),(.075,.016,.075),'metal')
    rod('roof_conductor_holder',(x,bottom+.016,z),(x,y,z),.012,'metal',8)
    box('conductor_saddle',(x,y,z),(.07,.055,.045),'paint')
    SUPPORTS.append({'roof':key,'foot':[x,bottom,z],'conductor':point})

def air_belt(cfg,key):
    x,z=cfg['halfExtent'];y=roof_y(cfg,z)
    ridge=cfg['size'][1]+.15
    loop=[[-x,y,-z],[x,y,-z],[x,ridge,0],[x,y,z],[-x,y,z],[-x,ridge,0],[-x,y,-z]]
    # Perimeter avoids the existing hoist rope-entry roof slot entirely.
    route('roof_perimeter',loop,roof_key=key)
    for a,b in zip(loop,loop[1:]):
        a,b=Vector(a),Vector(b);n=max(1,math.ceil((b-a).length/2.7))
        for i in range(n):roof_support(key,list(a.lerp(b,i/n)))
    if key=='distribution':
        for xx in (-3,3):
            line=[[xx,y,-z],[xx,cfg['size'][1]+.15,0],[xx,y,z]]
            route('roof_cross_conductor',line,roof_key=key)
            for point in line:roof_support(key,point)

def terminal(cfg):
    w,h,d=cfg['foundationSize'];top=cfg['height']
    box('foundation',(0,h/2,0),(w,h,d),'concrete',.018)
    box('mast_plate',(0,h+.023,0),(.48,.046,.48),'metal',.005)
    for x in (-.18,.18):
        for z in (-.18,.18):rod('anchor_bolt',(x,h+.046,z),(x,h+.10,z),.018,'metal',6)
    rod('mast_lower',(0,h+.046,0),(0,4.3,0),.095,'metal',24)
    rod('mast_middle',(0,4.2,0),(0,7.5,0),.056,'metal',24)
    rod('air_tip',(0,7.42,0),(0,top,0),.025,'metal',20)
    for y,r in ((4.25,.105),(7.45,.065)):
        rod('coupling_collar',(0,y-.04,0),(0,y+.04,0),r,'metal',20)
    for j in range(3):
        a=math.pi/6+j*math.tau/3;x,z=.51*math.cos(a),.51*math.sin(a)
        box('brace_anchor',(x,h+.03,z),(.20,.06,.20),'metal')
        rod('base_brace',(x,h+.06,z),(.05*math.cos(a),1.65,.05*math.sin(a)),.026,'metal',12)
    rod('grounding_lug',(-.12,.37,0),(-.055,.37,0),.03,'copper',8)
    route('mast_earth_entry',[[-.12,.37,0],[-.23,.28,0],[-.23,-.45,0]],'copper',.015)

def downlead(cfg,key):
    if key=='distribution':
        y=roof_y(cfg,4.2)
        points=[[-8.6,y,4.2],[-9.26,y,4.2],[-9.26,y+.06,3.8],[-9.26,.52,3.8],[-9.16,.52,3.1]]
        route('wall_down_conductor',points)
        for yy in (.8,1.8,2.8,3.8):
            box('wall_holder_plate',(-9.105,yy,3.8),(.016,.09,.07),'metal')
            rod('wall_holder',(-9.11,yy,3.8),(-9.26,yy,3.8),.013,'metal',8)
        box('accessible_test_link',(-9.26,.52,3.8),(.045,.16,.06),'copper')
    else:
        y=roof_y(cfg,5.5)
        points=[[9.35,y,5.5],[9.35,y,6.44],[9.35,.40,6.44],[9.35,-.5,6.44]]
        route('wall_down_conductor',points)
        for yy in (.8,1.8,2.8,3.8,4.8,5.7):
            box('wall_holder_plate',(9.35,yy,6.105),(.07,.09,.016),'metal')
            rod('wall_holder',(9.35,yy,6.11),(9.35,yy,6.44),.013,'metal',8)
        box('accessible_test_link',(9.35,.48,6.44),(.055,.14,.06),'copper')
        rod('local_earth_entry',(9.35,-.5,6.44),(9.35,-.8,6.44),.025,'copper',12)

def spd():
    # Four generic plug-in modules. No logos, ratings or live status implied.
    box('mounting_plate',(0,0,.075),(.30,.32,.012),'metal',.003)
    box('din_rail',(0,0,.045),(.19,.035,.014),'metal')
    box('terminal_base',(0,0,.013),(.105,.165,.05),'red',.002)
    for j in range(4):
        x=(j-1.5)*.025
        box('replaceable_module',(x,0,-.032),(.023,.112,.046),'red',.001)
        box('generic_module_label',(x,.008,-.056),(.019,.069,.002),'paint')
        box('indicator_window',(x,-.043,-.056),(.016,.015,.003),'green')
        for yy in (-.067,.067):
            rod('terminal_screw',(x,yy,-.022),(x,yy,-.012),.0065,'metal',10)
        color='yellow' if j==3 else 'dark'
        route('short_terminal_lead',[[x,.080,.012],[x,.12,.012],[x,.22,.06]],color,.003)
    route('bonding_lead',[[.042,-.08,.02],[.042,-.16,.02],[-.09,-.19,.075]],'green',.003)
    for x in (-.13,.13):
        for y in (-.14,.14):rod('mounting_screw',(x,y,.068),(x,y,.094),.005,'metal',8)

def cabinet_liner():
    # Reversible inspection insert for one existing closed LV cabinet only.
    box('cabinet_plinth',(0,.055,0),(.78,.11,1.1),'paint')
    box('cabinet_back',(0,1.235,.515),(.74,2.25,.025),'paint')
    for x in (-.365,.365):
        box('cabinet_side',(x,1.235,0),(.025,2.25,1.05),'paint')
        box('front_upright',(x,1.235,-.525),(.027,2.25,.026),'metal')
    for y in (.125,2.345):box('cabinet_crossmember',(0,y,-.525),(.74,.025,.04),'metal')
    # Mounting rails land on brackets which reach the preserved rear panel.
    for y in (.97,1.25):
        box('mounting_rail',(0,y,.10),(.66,.036,.025),'metal')
        for x in (-.27,.27):beam('rail_bracket',(x,y,.10),(x,y,.515),.035,.035,'metal')
    box('protective_earth_bar',(0,.36,.48),(.48,.035,.020),'copper')
    box('incoming_terminal_strip',(0,1.33,.06),(.125,.04,.035),'dark')
    box('terminal_mount',(0,1.30,.09),(.16,.12,.025),'metal')
    for j in range(4):
        x=(j-1.5)*.025
        rod('incoming_terminal',(x,1.315,.045),(x,1.345,.045),.006,'metal',10)
    route('cabinet_pe_connection',[[-.09,.92,.075],[-.14,.86,.075],[-.14,.36,.48]],'green',.003)

def ground_monitor():
    # West-facing generic enclosure with terminals; not just a bonding box.
    box('mount_backplate',(.09,0,0),(.016,.43,.35),'metal')
    for y in (-.12,.12):
        rod('wall_mount_standoff',(.09,y,0),(.103,y,0),.016,'metal',10)
        box('wall_mount_foot',(.101,y,0),(.012,.08,.08),'metal')
    box('sealed_box',(0,0,0),(.16,.38,.30),'paint',.007)
    box('door_seal',(-.083,0,0),(.007,.35,.27),'dark')
    box('inspection_front',(-.09,0,0),(.012,.34,.26),'paint',.003)
    box('display_window',(-.098,.065,0),(.008,.065,.14),'dark')
    box('blank_demo_readout',(-.104,.065,0),(.003,.042,.10),'green')
    for z in (-.06,0,.06):rod('terminal_fastener',(-.12,-.05,z),(-.096,-.05,z),.016,'metal',10)
    box('terminal_strip',(-.105,-.05,0),(.018,.05,.20),'copper')
    for z in (-.08,.08):
        rod('cable_gland',(0,-.23,z),(0,-.18,z),.018,'dark',12)
        route('monitor_local_lead',[[0,-.23,z],[-.05,-.9,z],[-.45,-.9,z],[-.45,-1.49,z]],'green' if z>0 else 'dark',.007)
    for y in (-.10,.10):box('door_hinge',(-.092,y,.142),(.022,.048,.022),'metal')

def earth_section():
    # Real below-ground local geometry, visible only through an inspection window.
    before=set(bpy.context.scene.objects)
    for z in (-.40,.40):box('soil_side',(.05,-.43,z),(.82,.75,.035),'soil')
    box('soil_back',(.435,-.43,0),(.035,.75,.80),'soil')
    box('soil_bottom',(0,-.83,0),(.90,.10,.90),'soil')
    for o in set(bpy.context.scene.objects)-before:o['displayRole']='cutaway'
    for x in (-.36,.36):box('inspection_rim',(x,.055,0),(.04,.11,.76),'concrete')
    for z in (-.36,.36):box('inspection_rim',(0,.055,z),(.68,.11,.04),'concrete')
    route('local_ground_bond',[[.49,.52,0],[0,.52,0],[0,-.18,0],[-.22,-.18,0]],'copper',.017)
    rod('local_earth_electrode',(-.22,-.18,0),(-.22,-.76,0),.025,'copper',16)
    box('electrode_clamp',(-.22,-.18,0),(.10,.06,.075),'metal')
    for z in (-.025,.025):rod('clamp_bolt',(-.25,-.145,z),(-.25,-.21,z),.008,'metal',6)
    # Terminals meet the monitor's two short local test leads.
    for z in (-.08,.08):
        box('test_terminal',(0,-.14,z),(.06,.045,.045),'metal')
        rod('test_lead_link',(0,-.14,z),(-.22,-.18,0),.007,'copper',8)

def export(path,kind):
    bpy.context.view_layer.update();objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
    root=bpy.data.objects.new('schematic-'+kind,None);bpy.context.collection.objects.link(root)
    root['facilityType']=kind;root['schematic']=True
    for o in objects:
        if not o.data.uv_layers:
            uv=o.data.uv_layers.new(name='UVMap')
            for face in o.data.polygons:
                axis=max(range(3),key=lambda i:abs(face.normal[i]));axes=[i for i in range(3) if i!=axis]
                for loop in face.loop_indices:
                    v=o.data.vertices[o.data.loops[loop].vertex_index].co;uv.data[loop].uv=(v[axes[0]],v[axes[1]])
    for role in ('main','cutaway'):
        for mat in p.M.values():
            members=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('displayRole','main')==role and o.data.materials[0]==mat]
            if not members:continue
            bpy.ops.object.select_all(action='DESELECT')
            for o in members:o.select_set(True)
            bpy.context.view_layer.objects.active=members[0]
            if len(members)>1:bpy.ops.object.join()
            o=bpy.context.object;o.name=kind+'__'+role+'__'+mat.name;o.parent=root;o['displayRole']=role
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    assert bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_extras=True,
        export_cameras=False,export_lights=False,export_animations=False)=={'FINISHED'}
    return {'file':path.name,'type':kind,'triangles':sum(len(f.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for f in o.data.polygons),
        'meshes':sum(o.type=='MESH' for o in bpy.context.scene.objects),'bytes':path.stat().st_size,
        'bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]}}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--parameters',default=str(Path(__file__).with_name('protection.parameters.json')))
    parser.add_argument('--output-dir',default=str(ROOT/'public/models'))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    cfg=json.loads(Path(args.parameters).read_text(encoding='utf-8-sig'));out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    protected();roof_trees(cfg);materials();outputs=[]
    builds=[('mine-air-terminal.glb','air-terminal',lambda:terminal(cfg['pole'])),
        ('mine-air-belt-hoist.glb','air-belt',lambda:air_belt(cfg['roofs']['hoist'],'hoist')),
        ('mine-air-belt-distribution.glb','air-belt',lambda:air_belt(cfg['roofs']['distribution'],'distribution')),
        ('mine-downlead-hoist.glb','down-conductor',lambda:downlead(cfg['roofs']['hoist'],'hoist')),
        ('mine-downlead-distribution.glb','down-conductor',lambda:downlead(cfg['roofs']['distribution'],'distribution')),
        ('mine-spd.glb','spd',spd),('mine-spd-cabinet-liner.glb','inspection-insert',cabinet_liner),
        ('mine-ground-monitor.glb','ground-monitor',ground_monitor),('mine-earth-section.glb','earth-section',earth_section)]
    for file,kind,build in builds:
        p.reset();start=len(ROUTES);build();result=export(out/file,kind);result['routes']=ROUTES[start:]
        assert result['triangles']<cfg['maxTrianglesPerModel'];assert result['bytes']<cfg['maxBytesPerModel'];outputs.append(result)
    report={'schematic':True,'outputs':outputs,'protectedFilesUnchanged':protected(),'roofSupports':SUPPORTS,'roofClearanceChecks':CHECKS,
        'scope':'Local visualization only; no risk class, coverage sphere, rated SPD or validated earth-resistance measurement topology.'}
    (out/'mine-protection.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PROTECTION_EXPORT_OK',json.dumps({'outputs':[{k:v for k,v in o.items() if k!='routes'} for o in outputs],'protectedFilesUnchanged':report['protectedFilesUnchanged']}))

if __name__=='__main__':main()
