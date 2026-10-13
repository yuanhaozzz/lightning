"""Power precinct only. Meters, Y-up parameter coordinates, fixed footprint origins.
Run Blender -b --factory-startup --python-exit-code 1 --python this_file.
Optional -- --parameters path --output-dir path. Reference photos are not textures.
Semantic groups survive material batching; roof and indoor equipment export separately.
This is an industrial visualization, not a rated electrical installation design.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_core_production as p

ROOT = Path(__file__).resolve().parents[2]
box, beam, rod, section = p.box, p.beam, p.rod, p.section
ENTITIES = []
ACTIVE = None
BARE_ROUTES = []


def materials():
    palette = {
        'concrete': ((.46,.48,.46),0,.90,'concrete'),
        'wall': ((.62,.64,.60),0,.85,'concrete'),
        'roof': ((.22,.30,.33),.55,.47,'steel'),
        'steel': ((.12,.19,.22),.68,.43,'steel'),
        'trim': ((.38,.44,.46),.75,.38,None),
        'machine': ((.27,.34,.32),.50,.48,'steel'),
        'ceramic': ((.30,.16,.09),.0,.24,None),
        'glass': ((.075,.17,.21),.2,.18,None),
        'dark': ((.035,.043,.045),0,.8,None),
        'safety': ((.81,.46,.085),.2,.48,None),
        'copper': ((.40,.21,.09),.85,.4,None),
    }
    for key, values in palette.items():
        p.M[key] = p.primitives.material('Power_'+key, *values)


def start(id, name, kind, position=None, size=None, parent_id=None):
    global ACTIVE
    ACTIVE = (id, set(bpy.context.scene.objects))
    ent = {'id':id, 'name':name, 'kind':kind}
    if position is not None:ent['position']=position
    if size is not None:ent['size']=size
    if parent_id:ent['parentId']=parent_id
    ENTITIES.append(ent)


def end():
    id, before = ACTIVE
    for obj in set(bpy.context.scene.objects)-before:obj['entityId']=id


def insulator(name, x, z, bottom, height, radius=.14, sheds=9):
    rod(name+'_core',(x,bottom,z),(x,bottom+height,z),radius*.42,'ceramic',12)
    rod(name+'_base',(x,bottom-.045,z),(x,bottom+.045,z),radius*1.1,'trim',12)
    for i in range(sheds):
        y=bottom+.1+(height-.16)*i/max(1,sheds-1)
        # Alternating wide/narrow closed porcelain sheds, not stacked cylinders.
        r=radius*(1 if i%2==0 else .82)
        vs=[]
        for yy,rr in ((y-.025,r*.7),(y,r),(y+.028,r*.48)):
            vs += [(x+rr*math.cos(j*math.tau/12),yy,z+rr*math.sin(j*math.tau/12)) for j in range(12)]
        fs=[tuple(reversed(range(12))),tuple(range(24,36))]
        for k in (0,12):
            fs += [(k+j,k+(j+1)%12,k+12+(j+1)%12,k+12+j) for j in range(12)]
        obj=p.mesh(name+'_shed',vs,[tuple(reversed(face)) for face in fs],'ceramic')
        for poly in obj.data.polygons:poly.use_smooth=len(poly.vertices)==4
    rod(name+'_terminal',(x,bottom+height-.04,z),(x,bottom+height+.13,z),.05,'trim',12)


def conductor(name, points, mat='trim', radius=.022):
    for a,b in zip(points,points[1:]):rod(name,a,b,radius,mat,8)
    if name in ('bus_drop','switch_to_breaker','breaker_to_transformer'):
        BARE_ROUTES.append((name,points,radius))


def check_substation_geometry():
    bpy.context.view_layer.update()
    prefixes=('gantry_', 'main_oil_tank', 'tank_', 'conservator', 'radiator_', 'breaker_drive', 'bay_local_control')
    trees=[]
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH' and obj.name.startswith(prefixes):
            trees.append(BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],
                                            [tuple(poly.vertices) for poly in obj.data.polygons]))
    queries=0;minimum=1000
    for _,points,radius in BARE_ROUTES:
        for a,b in zip(points,points[1:]):
            a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.025))
            for i in range(n+1):
                point=p.xyz(a.lerp(b,i/n))
                for tree in trees:
                    result=tree.find_nearest(point);queries+=1
                    minimum=min(minimum,result[3]-radius)
    assert minimum>.20, f'Bare conductor intersects grounded structure: {minimum}'
    return {'bareConductorToGroundedStructureMeters':minimum,'triangleDistanceQueries':queries,
            'checked':'gantry, tank, conservator, radiators and grounded equipment bodies; intentional terminals excluded'}


def substation(cfg):
    start('substation-foundations','设备基础与检修通道','foundation')
    box('equipment_yard',(0,.12,0),(18,.18,12),'concrete')
    box('west_service_walk',(-6,.225,0),(2.4,.03,11),'wall')
    box('transformer_foundation',(3,.37,2.4),(5.5,.42,4.4),'concrete',.04)
    for x in (1.95,4.05):box('mounting_rail',(x,.61,2.4),(.18,.12,2.6),'steel')
    # Covered cable trench along the southern service edge, no underground grid.
    for x in range(-4,7):box('trench_cover',(x,.235,5.15),(.97,.055,.7),'trim')
    for z in (-4.45,-.85):
        for x in (-6.9,6.9):
            box('gantry_pad',(x,.35,z),(.85,.40,.85),'concrete')
            section('gantry_column',(x,.55,z),(x,cfg['gantryHeight'],z),.26,.32)
        section('gantry_crossmember',(-6.9,cfg['gantryHeight'],z),(6.9,cfg['gantryHeight'],z),.25,.35)
        for i in range(10):
            xa=-6.9+i*1.38;xb=xa+1.38
            beam('gantry_lattice',(xa,cfg['gantryHeight']+.22,z),(xb,cfg['gantryHeight']-.22,z),.045,.07)
    end()
    start('power-transformer-01','油浸变压器','transformer',[3,0,2.4],[4.6,4.9,3.6])
    box('main_oil_tank',(3,1.90,2.4),(2.5,2.45,1.85),'machine',.06)
    box('tank_cover',(3,3.17,2.4),(2.7,.13,2.02),'trim',.025)
    for z in (1.7,3.1):
        box('tank_stiffener',(3,1.94,z),(2.60,.11,.07),'trim')
    # Attached radiator banks with top/bottom headers and oil pipes.
    for x in (1.25,4.75):
        for j in range(13):box('radiator_fin',(x,1.92,1.42+j*.16),(.67,1.8,.045),'machine')
        for y in (1.02,2.82):
            rod('radiator_header',(x,y,1.32),(x,y,3.48),.085,'trim',12)
            rod('radiator_pipe',(x,y,2.4),(3+(-1.27 if x<3 else 1.27),y,2.4),.07,'trim',12)
    # Conservator barrel on two brackets, breather and gauge on service side.
    for x in (2.2,3.8):
        beam('conservator_bracket',(x,3.2,3.05),(x,3.65,3.05),.07,.1)
    rod('conservator',(1.55,3.87,3.05),(4.45,3.87,3.05),.28,'machine',24)
    conductor('conservator_oil_pipe',[(1.7,3.8,3.05),(1.7,3.43,2.65),(1.7,3.18,2.65)],radius=.045)
    rod('breather',(1.65,2.6,3.52),(1.65,2.94,3.52),.08,'glass',12)
    conductor('breather_pipe',[(1.65,2.94,3.52),(1.65,3.87,3.52),(1.7,3.87,3.05)],radius=.025)
    rod('oil_level_gauge',(1.52,3.87,3.05),(1.46,3.87,3.05),.12,'dark',16)
    for i,x in enumerate((2.05,3,3.95)):
        insulator('hv_bushing',x,1.7,3.23,1.06,.17,12)
        insulator('lv_bushing',x,2.7,3.23,.48,.10,6)
        conductor('lv_cable',[(x,3.84,2.7),(x,4.15+i*.14,2.85+i*.18),(5.2+i*.14,4.15+i*.14,2.85+i*.18),(5.2+i*.14,.4,4.6+i*.12)],'dark',.028)
    box('transformer_terminal_box',(4.31,1.8,2.5),(.16,.65,.58),'roof')
    for x in (1.87,4.13):
        rod('lifting_eye',(x,3.2,1.5),(x,3.35,1.5),.075,'trim',10)
    conductor('tank_ground_bond',[(1.8,.9,3.3),(1.4,.4,3.65),(1.4,.25,4.8)],'copper',.018)
    end()
    start('substation-switch-bay-01','三相母线及开关间隔','switch-bay')
    # Three independent longitudinal phase buses; device terminals connected
    # in order: bus -> closed disconnector -> breaker -> transformer HV bushing.
    for x in (2.05,3,3.95):
        for z in (-4.45,-.85):insulator('bus_post',x,z,cfg['gantryHeight']+.18,cfg['busHeight']-cfg['gantryHeight']-.25,.13,7)
        rod('phase_bus',(x,cfg['busHeight'],-4.7),(x,cfg['busHeight'],-.85),.035,'trim',12)
        BARE_ROUTES.append(('phase_bus',[(x,cfg['busHeight'],-4.7),(x,cfg['busHeight'],-.85)],.035))
        box('switch_pad',(x,.38,-2.3),(.48,.35,1.65),'concrete')
        for z in (-2.85,-1.85):
            beam('disconnect_stand',(x,.55,z),(x,2.05,z),.11,.13)
            insulator('disconnect_post',x,z,2.06,1.08,.135,10)
        rod('closed_disconnect_blade',(x,3.22,-2.85),(x,3.22,-1.85),.035,'trim',10)
        conductor('bus_drop',[(x,cfg['busHeight'],-2.5),(x,4.05,-2.72),(x,3.22,-2.85)])
        box('breaker_pad',(x,.37,-.25),(.5,.35,.70),'concrete')
        box('breaker_drive',(x,1.25,-.25),(.36,1.42,.46),'machine',.025)
        insulator('breaker_interrupter',x,-.25,1.96,1.13,.15,11)
        conductor('switch_to_breaker',[(x,3.22,-1.85),(x,3.52,-1.4),(x,3.22,-.25)])
        conductor('breaker_to_transformer',[(x,3.22,-.25),(x,4.05,.5),(x,4.42,1.7)])
    # Operable linkage joins the three poles, outside live terminal planes.
    rod('disconnect_operating_shaft',(1.7,1.8,-2.85),(4.3,1.8,-2.85),.025,'steel',8)
    box('bay_local_control',(5.4,1.03,-2.5),(.55,1.3,.48),'machine',.02)
    box('control_panel',(5.4,1.20,-2.245),(.39,.44,.025),'dark')
    end()
    start('substation-inner-fence','设备安全围栏与入口','safety-fence')
    # Inner equipment fence complements existing precinct perimeter; west gate
    # leaves 3 m at the original access center. No posts enter the access road.
    lines=[((-8.65,-5.65),(8.65,-5.65)),((8.65,-5.65),(8.65,5.65)),((8.65,5.65),(-8.65,5.65)),((-8.65,-5.65),(-8.65,-1.5)),((-8.65,1.5),(-8.65,5.65))]
    for a,b in lines:
        length=math.dist(a,b);n=math.ceil(length/2)
        for i in range(n+1):
            x=a[0]+(b[0]-a[0])*i/n;z=a[1]+(b[1]-a[1])*i/n
            rod('fence_post',(x,.2,z),(x,1.9,z),.033,'steel',8)
        for y in (.3,1,1.8):rod('fence_rail',(a[0],y,a[1]),(b[0],y,b[1]),.023,'trim',6)
        for i in range(math.ceil(length/.22)):
            t=(i+.5)*.22/length
            x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
            rod('fence_picket',(x,.3,z),(x,1.8,z),.009,'trim',6)
    box('gate_warning_plate',(-8.67,1.38,1.95),(.025,.35,.45),'safety')
    end()


def distribution(cfg):
    start('distribution-shell','配电室建筑外壳','building')
    box('floor_slab',(0,.18,0),(18,.26,9),'concrete')
    # Clear western double door on original road axis, north/south windows.
    p.wall('room_west','z',-9,-4.5,4.5,4.05,[[-1.15,1.15,.31,3.0]])
    p.wall('room_east','z',9,-4.5,4.5,4.05,[[-1.2,1.2,2.0,3.25]])
    for z in (-4.5,4.5):
        p.wall('room_facade','x',z,-9,9,4.05,[[-7,-4.5,2.7,3.55],[-1.5,1.5,2.7,3.55],[4.5,7,2.7,3.55]])
    for x in (-8.7,-4,0,4,8.7):
        for z in (-4.23,4.23):section('room_column',(x,.31,z),(x,4.03,z),.16,.2)
    for z in (-4.2,4.2):beam('eaves_tie',(-8.8,3.92,z),(8.8,3.92,z),.12,.18)
    # Open doors folded back along west facade rather than into the aisle.
    for sign in (-1,1):
        box('door_leaf',(-9.13,1.57,sign*1.70),(.08,2.5,1.05),'roof')
        for y in (.72,1.20,1.68,2.16):box('door_rib',(-9.18,y,sign*1.7),(.04,.035,.95),'trim')
    box('entry_threshold',(-9.22,.18,0),(.44,.10,2.45),'concrete')
    for sign in (-1,1):
        box('wall_louvre',(8.83,1.2,sign*2.8),(.025,.8,1.25),'dark')
        for y in (.88,1.02,1.16,1.30,1.44):box('louvre_blade',(8.91,y,sign*2.8),(.10,.035,1.2),'trim')
    box('east_ventilation_unit',(8.5,1.3,3.7),(.55,1.4,.62),'machine')
    end()


def roof(cfg):
    start('distribution-roof','配电室可隐藏屋顶','roof')
    # Gables and roof rafters are part of removable roof assembly; nothing
    # from the indoor trays/cabinets is merged into this asset.
    p.roof(18,9,cfg['eaves'],cfg['roofPeak'])
    # Shared older primitive uses two coincident gable faces. Replace these
    # locally with closed triangular masonry prisms; leave old scripts intact.
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith('gable'):bpy.data.objects.remove(obj,do_unlink=True)
    for x in (-9,9):
        verts=[(xx,y,z) for xx in (x-.10,x+.10) for y,z in ((cfg['eaves'],-4.5),(cfg['eaves'],4.5),(cfg['roofPeak'],0))]
        p.mesh('closed_gable',verts,[(0,1,2),(5,4,3),(3,4,1,0),(4,5,2,1),(5,3,0,2)],'wall')
    for x in (-8.7,-4,0,4,8.7):
        for sign in (-1,1):section('roof_rafter',(x,3.97,sign*4.23),(x,4.38,0),.14,.18)
    end()


def cabinet(cfg, row, index):
    sign=-1 if row=='mv' else 1
    x=(index-(cfg['countPerRow']-1)/2)*cfg['pitch'];z=sign*cfg['rowZ']
    w,h,d=cfg['width'],cfg['height'],cfg['depth'];base=.31
    id=f'power-cabinet-{row}-{index+1:02d}'
    start(id,f'{"高压" if row=="mv" else "低压"}配电柜 {index+1:02d}','cabinet',[x,base,z],[w,h+.11,d])
    box('cabinet_plinth',(x,base+.055,z),(w,.11,d),'machine')
    box('cabinet_body',(x,base+.11+h/2,z),(w-.035,h,d),'machine',.018)
    front=z-sign*(d/2+.015)
    for ya,yb in ((.18,.65),(.70,1.65),(1.70,2.18)):
        box('separate_door',(x,base+(ya+yb)/2,front),(w-.075,yb-ya,.035),'wall')
        box('door_handle',(x+w*.32,base+(ya+yb)/2,front-sign*.04),(.028,.12,.04),'trim')
    box('meter_window',(x,base+1.93,front-sign*.022),(.30,.20,.025),'dark')
    box('meter_face',(x,base+1.93,front-sign*.037),(.25,.14,.009),'dark')
    for dx in (-.17,0,.17):
        rod('status_lamp',(x+dx,base+1.61,front),(x+dx,base+1.61,front-sign*.055),.025,'safety',8)
    for yy in (.29,.35,.41):box('cabinet_vent',(x,base+yy,front-sign*.022),(w-.18,.024,.013),'dark')
    box('cabinet_nameplate',(x,base+.77,front-sign*.023),(.3,.065,.013),'trim')
    # Inspection aperture frames are visible, HV power conductors stay enclosed.
    box('inspection_port',(x,base+1.16,front-sign*.025),(.20,.21,.022),'dark')
    box('inspection_glass',(x,base+1.16,front-sign*.040),(.15,.16,.016),'dark')
    for dx in (-.23,.23):rod('cable_entry_gland',(x+dx,base+h+.10,z),(x+dx,base+h+.22,z),.035,'dark',8)
    end()


def interior(cfg, reserves):
    start('distribution-cable-trays','电缆桥架及照明','cable-tray')
    for z in (-2,2):
        # Ladder tray: actual sidewalls and spaced rungs, open center.
        for dz in (-.27,.27):box('tray_side',(0,3.18,z+dz),(9.8,.16,.035),'trim')
        for i in range(33):box('tray_rung',(-4.8+i*.3,3.12,z),(.035,.035,.54),'trim')
        for x in (-4.6,-2.3,0,2.3,4.6):
            for dz in (-.26,.26):rod('tray_hanger',(x,3.23,z+dz),(x,3.88,z+dz),.015,'steel',6)
        for offset in (-.13,0,.13):rod('sheathed_cables',(-4.8,3.20,z+offset),(4.8,3.20,z+offset),.028,'dark',8)
    for z in (-2,2):conductor('incoming_cable_riser',[(-4.8,3.2,z),(-5.9,3.2,z),(-5.9,.42,z)],'dark',.065)
    for x in (-6,0,6):box('indoor_light',(x,3.86,0),(1.1,.09,.22),'wall')
    # Central operating aisle: clear width 2.85 m, not occupied by tray risers.
    for z in (-1.22,1.22):box('aisle_edge_mark',(0,.321,z),(7.5,.008,.04),'safety')
    box('ground_busbar',(-7.3,.48,3.9),(1.2,.05,.045),'copper')
    conductor('room_ground_bond',[(-7.9,.48,3.9),(-8.95,.48,3.9),(-9.16,.48,3.1),(-9.16,.18,3.1)],'copper',.018)
    end()
    for row in ('mv','lv'):
        for i in range(cfg['countPerRow']):cabinet(cfg,row,i)
    for reserve in reserves:
        start(reserve['id'],reserve['name'],reserve['kind'],reserve['position'],reserve['size'],reserve.get('parentId'))
        x,y,z=reserve['position'];w,h,d=reserve['size']
        if reserve['kind']=='spd-reserve':
            # Empty mounting plate beside incoming LV cubicle, no fake SPD device.
            box('spd_mounting_plate',(x,y,z),(w,h,.025),'safety')
            for dx in (-w/2,w/2):box('spd_plate_side',(x+dx,y,z),(.018,h,.04),'trim')
        elif reserve['kind']=='grounding-monitor-reserve':
            box('empty_monitor_bracket',(x,y,z),(w,.035,d),'safety')
            box('monitor_mount',(x+.05,y+.12,z),(.025,.27,d),'trim')
            beam('wall_monitor_bracket',(x+.05,y+.12,z),(x+.16,y+.12,z),.025,.06,'trim')
        elif reserve['kind']=='grounding-interface':
            box('bond_test_link',(x,y,z),(w,h,d),'copper')
        else:
            box('ground_test_cover',(x,y,z),(w,h,d),'trim')
            box('test_cover_mark',(x,y+h/2+.005,z),(.26,.01,.045),'safety')
        end()


def export(path):
    bpy.context.view_layer.update()
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];source_count=len(objects)
    minv=[min((o.matrix_world@v.co)[i] for o in objects for v in o.data.vertices) for i in range(3)]
    maxv=[max((o.matrix_world@v.co)[i] for o in objects for v in o.data.vertices) for i in range(3)]
    ids=sorted(set(o['entityId'] for o in objects))
    # Batch ONLY within a semantic entity; picking IDs survive glTF extras.
    for id in ids:
        empty=bpy.data.objects.new(id,None);bpy.context.collection.objects.link(empty)
        ent=next(e for e in ENTITIES if e['id']==id)
        for key,value in ent.items():empty[key]=value
        for mat in p.M.values():
            members=[o for o in list(bpy.context.scene.objects) if o.type=='MESH' and o.get('entityId')==id and o.data.materials[0]==mat]
            if not members:continue
            for obj in members:
                if not obj.data.uv_layers:
                    uv=obj.data.uv_layers.new(name='UVMap')
                    for poly in obj.data.polygons:
                        axis=max(range(3),key=lambda i:abs(poly.normal[i]));axes=[i for i in range(3) if i!=axis]
                        for loop in poly.loop_indices:
                            v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                            uv.data[loop].uv=(v[axes[0]],v[axes[1]])
            bpy.ops.object.select_all(action='DESELECT')
            for obj in members:obj.select_set(True)
            bpy.context.view_layer.objects.active=members[0];bpy.ops.object.join()
            obj=bpy.context.object;obj.name=id+'__'+mat.name;obj.parent=empty
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    result=bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_extras=True,
                                   export_cameras=False,export_lights=False,export_animations=False)
    assert result=={'FINISHED'}
    tris=sum(len(poly.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for poly in o.data.polygons)
    return {'file':path.name,'triangles':tris,'meshes':sum(o.type=='MESH' for o in bpy.context.scene.objects),
            'sourcePieces':source_count,'bytes':path.stat().st_size,'entityIds':ids,
            'bounds':{'min':[minv[0],minv[2],-maxv[1]],'max':[maxv[0],maxv[2],-minv[1]]}}


def protected():
    records=json.loads((ROOT/'scripts/blender/power_area.protected-baseline.json').read_text(encoding='utf-8-sig'))
    for item in records:
        assert hashlib.sha256((ROOT/item['path']).read_bytes()).hexdigest().upper()==item['hash'],item['path']
    return len(records)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--parameters',default=str(Path(__file__).with_name('power_area.parameters.json')))
    parser.add_argument('--output-dir',default=str(ROOT/'public/models'))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    cfg=json.loads(Path(args.parameters).read_text());out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    protected();materials();outputs=[];geometry_checks={}
    for filename,build in [('mine-substation.glb',lambda:substation(cfg['substation'])),
                           ('mine-distribution-shell.glb',lambda:distribution(cfg['distribution'])),
                           ('mine-distribution-roof.glb',lambda:roof(cfg['distribution'])),
                           ('mine-distribution-equipment.glb',lambda:interior(cfg['cabinet'],cfg['reserves']))]:
        p.reset();build()
        if filename=='mine-substation.glb':geometry_checks=check_substation_geometry()
        outputs.append(export(out/filename))
    total=sum(o['triangles'] for o in outputs);size=sum(o['bytes'] for o in outputs)
    assert total<cfg['maxTriangles'];assert size<cfg['maxBytes']
    ids=[e['id'] for e in ENTITIES];assert len(ids)==len(set(ids))
    # Clear maintenance aisle and real enclosure dimensions, intentionally
    # conservative boxes used for access checks, not electrical clearance claims.
    aisle=2*cfg['cabinet']['rowZ']-cfg['cabinet']['depth']
    rear=4.5-.2-cfg['cabinet']['rowZ']-cfg['cabinet']['depth']/2
    assert aisle>=2.4 and rear>=1.2
    report={'outputs':outputs,'entities':ENTITIES,'totalTriangles':total,'totalBytes':size,
            'protectedFiles':protected(),'geometryChecks':geometry_checks,'checks':{'centralAisleMeters':aisle,'rearAccessMeters':rear,
            'westDoorClearWidth':2.3,'cabinetGapMeters':cfg['cabinet']['pitch']-cfg['cabinet']['width'],
            'indoorTopClearanceMeters':3.12-(.31+.11+cfg['cabinet']['height']+.12),
            'substationWestGateWidth':3.0},'scope':'industrial visualization; no underground ground grid or electrical rating certification'}
    (out/'mine-power-area.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('POWER_AREA_EXPORT_OK',json.dumps({'triangles':total,'bytes':size,'outputs':outputs}))


if __name__=='__main__':main()
