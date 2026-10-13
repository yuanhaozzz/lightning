"""One reversible distribution-room / LV01 inspection sample, meters and Y-up.

Exports a NEW additive GLB only. Existing GLBs and generators are never modified.
The room shell is the exact original distribution() geometry regrouped by role.
LV01 replaces its closed solid with a hollow, mechanically hinged cabinet.
The existing spd-lv-01 and status lamps remain external reusable scene assets.
Run Blender -b --factory-startup --python-exit-code 1 --python this_file.
This generic schematic is not a manufacturer's electrical assembly drawing.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_core_production as core
import generate_power_area as power

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads(Path(__file__).with_name('distribution_drilldown.parameters.json').read_text())
P = Vector(CFG['cabinetPosition'])
GROUPS = {}
ACTIVE = None


def pieces():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bounds(objects):
    bpy.context.view_layer.update()
    coords = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    lo = [min(v[i] for v in coords) for i in range(3)]
    hi = [max(v[i] for v in coords) for i in range(3)]
    return {'min': [lo[0], lo[2], -hi[1]], 'max': [hi[0], hi[2], -lo[1]]}


def begin(name, role, explode=(0, 0, 0), pivot=None, parent='power-cabinet-lv-01-detail'):
    global ACTIVE
    GROUPS[name] = {'name': name, 'role': role, 'explodeVector': list(explode),
                    'pivot': list(pivot if pivot is not None else P), 'parent': parent}
    ACTIVE = name


def attach(obj):
    obj['drilldownGroup'] = ACTIVE
    return obj


def box(name, center, size, mat='paint', bevel=0):
    return attach(core.box(name, P + Vector(center), size, mat, bevel))


def rod(name, a, b, radius, mat='trim', vertices=12):
    return attach(core.rod(name, P + Vector(a), P + Vector(b), radius, mat, vertices))


def route(name, points, radius=.009, mat='dark'):
    for a, b in zip(points, points[1:]):
        rod(name, a, b, radius, mat, 8)


def screw(x, y, z, name='fastener', radius=.006):
    rod(name, (x, y, z), (x, y, z-.009), radius, 'trim', 6)


def new_materials():
    power.materials()
    palette = {
        'paint': ((.55,.59,.58), .42,.48,'steel'),
        'galvanized': ((.38,.42,.43), .78,.39,'steel'),
        'insulation': ((.038,.049,.052), .03,.70,None),
        'phaseA': ((.52,.20,.08), .75,.35,None),
        'earth': ((.16,.28,.075), .1,.62,None),
        'label': ((.74,.77,.72), .05,.69,None),
    }
    for key, values in palette.items():
        core.M[key] = core.primitives.material('Drilldown_'+key, *values)


def shell():
    power.distribution({})
    shell_objects = pieces()
    before = bounds(shell_objects)
    for name, role in [('distribution-shell-floor','floor'),
                       ('distribution-shell-walls','walls'),
                       ('distribution-shell-structure','structure')]:
        begin(name, role, pivot=(0,0,0), parent=None)
    for obj in shell_objects:
        if obj.name.startswith(('floor_slab','entry_threshold')):
            role='distribution-shell-floor'
        elif obj.name.startswith(('room_column','eaves_tie')):
            role='distribution-shell-structure'
        else:
            role='distribution-shell-walls'
        obj['drilldownGroup']=role
        if 'entityId' in obj:del obj['entityId']
    return before, len(shell_objects)


def cabinet():
    begin('cabinet-frame','frame')
    # Six thin enclosure panels form a real hollow cabinet. Front stays open.
    box('plinth', (0,.055,0), (.82,.11,1.15), 'machine', .006)
    box('rear_panel', (0,1.235,.558), (.785,2.25,.026), 'paint', .005)
    for x in (-.3925,.3925):
        box('side_sheet', (x,1.235,0), (.025,2.25,1.15), 'paint', .004)
        box('folded_front_upright',(x,1.235,-.547),(.035,2.25,.044),'galvanized',.003)
        # Internal bracket rivets are visible at inspection distance.
        for y in (.20,.88,1.58,2.27):
            rod('upright_fixing',(x-.009,y,-.555),(x-.009,y,-.572),.006,'trim',6)
    for y in (.123,2.347):
        box('top_bottom_sheet',(0,y,0),(.785,.026,1.15),'paint',.004)
        box('front_crossmember',(0,y,-.547),(.75,.040,.044),'galvanized',.003)
    for x in (-.28,.28):
        rod('incoming_gland',(x,2.36,0),(x,2.46,0),.035,'dark',12)
        rod('gland_locknut',(x,2.367,0),(x,2.385,0),.043,'trim',6)
    for y in (.48,1.28,2.07):
        # Stationary hinge leaves stay on the cabinet jamb.
        box('stationary_hinge_leaf',(-.385,y,-.558),(.048,.11,.025),'trim',.003)
        rod('hinge_pin',(-.387,y-.047,-.59),(-.387,y+.047,-.59),.012,'trim',12)

    hinge = P + Vector(CFG['hinge'])
    begin('cabinet-door','door',pivot=hinge)
    # A single true hinged door carries its handle, meter, ribs, fasteners.
    box('door_skin',(0,1.235,-.590),(.747,2.18,.027),'paint',.005)
    for x in (-.354,.354):
        box('folded_door_edge',(x,1.235,-.566),(.019,2.14,.038),'paint',.002)
    for y in (.165,2.305):
        box('folded_door_edge',(0,y,-.566),(.715,.02,.038),'paint',.002)
    for y in (.48,1.28,2.07):
        box('rotating_hinge_leaf',(-.357,y,-.59),(.06,.068,.024),'trim',.002)
    box('latch_escutcheon',(.267,1.07,-.609),(.065,.25,.023),'insulation',.007)
    box('lever_handle',(.265,1.09,-.647),(.029,.18,.033),'trim',.006)
    rod('latch_cylinder',(.265,.99,-.63),(.265,.99,-.656),.013,'trim',12)
    box('meter_bezel',(0,1.93,-.617),(.303,.204,.036),'insulation',.006)
    box('meter_glass',(0,1.951,-.638),(.258,.133,.009),'glass',.002)
    for x in (-.072,-.024,.024,.072):
        box('meter_key',(x,1.856,-.638),(.024,.018,.011),'trim',.002)
    box('generic_nameplate',(0,.77,-.608),(.30,.065,.010),'label',.002)
    for yy in (.28,.33,.38):
        box('vent_shadow',(0,yy,-.606),(.56,.022,.006),'insulation')
        box('vent_fold',(0,yy+.010,-.615),(.56,.009,.020),'paint',.002)
    # Original independent runtime lamps remain at exactly these three centers.
    for x in (-.17,0,.17):
        rod('lamp_bezel',(x,1.61,-.604),(x,1.61,-.629),.030,'insulation',16)
    for x in (-.31,.31):
        for y in (.21,2.26):screw(x,y,-.607)

    begin('cabinet-backplate','backplate',(0,0,-.10))
    box('mounting_backplate',(0,1.24,.270),(.68,1.96,.023),'galvanized',.003)
    for x in (-.29,.29):
        for y in (.32,2.17):
            rod('backplate_standoff',(x,y,.282),(x,y,.544),.022,'trim',10)
            screw(x,y,.257)
    # Rails/standoffs align with mount fasteners, not floating decorations.
    for y in (.52,1.11,1.94):
        box('horizontal_support',(0,y,.211),(.64,.035,.020),'trim',.002)
        for x in (-.27,.27):
            box('rail_spacer',(x,y,.237),(.036,.052,.055),'trim',.002)

    begin('cabinet-busbars','busbars',(0,.32,-.24))
    for i, y in enumerate((1.79,1.945,2.10)):
        box('phase_busbar',(0,y,.127),(.54,.043,.014),'copper',.003)
        for x in (-.225,.225):
            rod('insulating_support',(x,y,.25),(x,y,.153),.037,'ceramic',12)
            rod('busbar_bolt',(x,y,.114),(x,y,.143),.009,'trim',6)
        x=(-.20,0,.20)[i]
        box('busbar_phase_terminal',(x,y,.108),(.042,.080,.018),'copper',.002)
        screw(x,y,.091)
    # Four outgoing top terminals, with insulated separators.
    box('incoming_terminal_carrier',(0,2.255,.132),(.54,.10,.08),'insulation',.003)
    for x in (-.20,-.066,.066,.20):
        box('incoming_terminal_clamp',(x,2.26,.080),(.075,.071,.025),'trim',.002)
        screw(x,2.26,.064)

    begin('cabinet-breaker','breaker',(-.43,-.015,-.62))
    # Generic moulded-case breaker; casing, covers, terminals, toggle distinct.
    box('breaker_mounting_rail',(0,.58,.18),(.38,.034,.02),'trim',.002)
    box('breaker_case',(0,.58,.095),(.286,.36,.15),'insulation',.008)
    box('breaker_front',(0,.588,.012),(.257,.298,.024),'machine',.007)
    box('breaker_toggle_recess',(.055,.59,-.006),(.064,.13,.012),'dark',.003)
    box('breaker_toggle',(.055,.615,-.024),(.04,.063,.039),'trim',.003)
    box('breaker_generic_label',(-.05,.675,-.004),(.097,.072,.004),'label',.001)
    for y in (.375,.785):
        for x in (-.088,0,.088):
            box('breaker_terminal_recess',(x,y,.077),(.072,.065,.075),'insulation',.003)
            box('breaker_terminal',(x,y,.04),(.035,.026,.014),'copper',.002)
            screw(x,y,.031)
    for x in (-.11,.11):
        for y in (.465,.70):screw(x,y,-.003)

    begin('cabinet-terminal-rail','terminal-rail',(.43,-.08,-.44))
    box('outgoing_din_rail',(0,.25,.13),(.62,.035,.035),'trim',.003)
    for i in range(9):
        x=(i-4)*.058
        box('terminal_block',(x,.265,.078),(.049,.09,.076),'earth' if i==8 else 'paint',.003)
        box('terminal_marker',(x,.268,.035),(.035,.04,.007),'label',.001)
        for y in (.236,.295):screw(x,y,.03,radius=.004)
    box('protective_earth_bar',(0,.155,.20),(.58,.035,.018),'copper',.002)
    for x in (-.24,-.12,0,.12,.24):screw(x,.155,.187)

    begin('cabinet-spd-mount','spd-mount',(0,0,-.42))
    # Existing SPD volume: x±.15, y .92..1.333, z -.058..+.094.
    # Mount/rail sits BEHIND that volume; no duplicate SPD is generated.
    box('spd_din_rail',(0,1.11,.108),(.36,.036,.021),'trim',.002)
    for x in (-.18,.18):
        box('spd_support_bracket',(x,1.11,.19),(.03,.04,.17),'trim',.002)
        screw(x,1.11,.098)

    begin('cabinet-cables','cables',(0,0,-.10))
    # Main feeder routes flank the SPD mounting envelope. Copper bars and
    # outgoing breaker have actual terminal endpoints; no decorative pipes.
    for i, (x,y) in enumerate(zip((-.20,0,.20),(1.79,1.945,2.10))):
        side=(-.305,-.27,.305)[i]
        bx=(-.088,0,.088)[i]
        route('phase_feeder',[(x,y,.11),(side,y,.06),(side,.85,.06),(bx,.85,.075),(bx,.785,.075)],.013,'dark')
        route('breaker_load_lead',[(bx,.375,.076),(bx,.33,.08),(bx,.305,.08)],.011,'dark')
    # Cable duct on each side has discernible comb slots and a narrow lid.
    for x in (-.338,.338):
        box('cable_duct_base',(x,1.20,.19),(.039,1.84,.025),'paint')
        for i in range(34):
            box('cable_duct_finger',(x,.30+i*.052,.145),(.041,.02,.083),'paint')
    route('protective_earth',[(.29,.155,.19),(.30,.42,.19),(.30,.85,.09),(-.09,.92,.075)],.006,'earth')
    # Incoming feeder glands connect down to top clamps behind the bars.
    for x in (-.28,.28):
        route('incoming_sheathed_feeder',[(x,2.43,0),(x,2.30,.06),(x*.714,2.26,.08)],.023,'dark')


def export(path, shell_bounds, shell_count):
    bpy.context.view_layer.update()
    source_objects=pieces()
    by_group={name:[] for name in GROUPS}
    for o in source_objects:by_group[o['drilldownGroup']].append(o)
    grouped_bounds={key:bounds(members) for key,members in by_group.items()}
    root=bpy.data.objects.new('distribution-drilldown-root',None)
    bpy.context.collection.objects.link(root)
    root['units']='meters';root['up']='Y';root['schematic']=True
    root['roomId']='distribution-01';root['scenePosition']=CFG['roomPosition']
    root['originContract']='room-local coordinates; attach once at room position; never independently recenter'
    cabinet_root=bpy.data.objects.new('power-cabinet-lv-01-detail',None)
    bpy.context.collection.objects.link(cabinet_root)
    cabinet_root.parent=root;cabinet_root.location=core.xyz(P)
    cabinet_root['drilldownId']=CFG['sampleCabinetId'];cabinet_root['entityId']=CFG['sampleCabinetId']
    cabinet_root['drilldownRole']='cabinet';cabinet_root['frontDirection']=CFG['forward']
    metadata=[]
    for name, conf in GROUPS.items():
        group=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(group)
        parent=cabinet_root if conf['parent'] else root
        group.parent=parent
        pivot=Vector(conf['pivot'])
        group.location=core.xyz(pivot-(P if conf['parent'] else Vector((0,0,0))))
        group['drilldownRole']=conf['role'];group['explodeVector']=conf['explodeVector']
        # Name labels attach to real component bounds. Current dots trace only
        # the main feeder / breaker branch, never the surge-only SPD branch.
        bb=grouped_bounds[name]
        group['labelAnchorCabinet']=[(bb['min'][i]+bb['max'][i])/2-P[i] for i in range(3)] if conf['parent'] else [0,0,0]
        if conf['role']=='cables':
            group['flowPathCabinet']=[[-.20,1.79,.11],[-.305,1.79,.06],[-.305,.85,.06],[-.088,.85,.075],[-.088,.785,.075],[-.088,.375,.076],[-.088,.305,.08]]
            group['flowCircuit']='main-feeder-through-breaker; illustrative current only; excludes SPD'
        group['drilldownId']=CFG['sampleCabinetId']+'/'+conf['role'] if conf['parent'] else name
        group['entityId']=CFG['sampleCabinetId'] if conf['parent'] else 'distribution-shell'
        if conf['role']=='door':
            group['hingeLocal']=CFG['hinge'];group['rotationAxis']=[0,1,0]
            group['openAngleRadians']=CFG['openAngleRadians']
        bpy.context.view_layer.update()
        material_groups={}
        for obj in by_group[name]:
            material_groups.setdefault(obj.data.materials[0].name,[]).append(obj)
        for matname,members in sorted(material_groups.items()):
            for obj in members:
                if not obj.data.uv_layers:
                    uv=obj.data.uv_layers.new(name='UVMap')
                    for poly in obj.data.polygons:
                        axis=max(range(3),key=lambda i:abs(poly.normal[i]));axes=[i for i in range(3) if i!=axis]
                        for loop in poly.loop_indices:
                            v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                            uv.data[loop].uv=(v[axes[0]]*2,v[axes[1]]*2)
            bpy.ops.object.select_all(action='DESELECT')
            for obj in members:obj.select_set(True)
            bpy.context.view_layer.objects.active=members[0]
            if len(members)>1:bpy.ops.object.join()
            obj=bpy.context.object;obj.name=name+'__'+matname
            bpy.context.view_layer.update();world=obj.matrix_world.copy()
            obj.parent=group;bpy.context.view_layer.update();obj.matrix_basis=group.matrix_world.inverted()@world
            for key in list(obj.keys()):del obj[key]
        metadata.append({'name':name,'drilldownId':group['drilldownId'],'role':conf['role'],
                         'parent':parent.name,'pivotRoom':conf['pivot'],
                         'explodeVector':conf['explodeVector'],'boundsRoom':grouped_bounds[name]})
    bpy.context.view_layer.update()
    all_shell=[o for name in ('distribution-shell-floor','distribution-shell-walls','distribution-shell-structure')
               for o in bpy.data.objects[name].children if o.type=='MESH']
    after=bounds(all_shell)
    drift=max(abs(after[k][i]-shell_bounds[k][i]) for k in ('min','max') for i in range(3))
    assert drift<1e-5
    tris=sum(len(p.vertices)-2 for o in pieces() for p in o.data.polygons)
    assert tris<CFG['maxTriangles']
    path.parent.mkdir(parents=True,exist_ok=True)
    result=bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,
        export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    assert result=={'FINISHED'} and path.stat().st_size<CFG['maxBytes']
    usedmats={m.name for o in pieces() for m in o.data.materials}
    return {'file':path.name,'bytes':path.stat().st_size,'triangles':tris,
            'meshes':len(pieces()),'materials':len(usedmats),'sourcePieces':len(source_objects),
            'shellSourcePieces':shell_count,'shellBounds':after,'shellBoundsDriftMeters':drift,
            'groups':metadata,'dimensions':{'width':.82,'bodyHeight':2.25,'depth':1.15},
            'existingSpd':{'id':'spd-lv-01','worldPosition':CFG['originalSpdWorldPosition'],
                           'cabinetPosition':CFG['originalSpdCabinetPosition'],'generatedDuplicate':False},
            'hinge':{'pivotCabinet':CFG['hinge'],'axis':[0,1,0],'openAngleRadians':CFG['openAngleRadians']},
            'scope':'one generic LV cabinet sample; semantic shell regroup only; no original GLB changed'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',default=str(ROOT/'tmp/distribution-drilldown-candidate'))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    # Hash original assets before/after, without changing any older protected baseline.
    originals={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'public/models').glob('*.glb')
               if p.name!='mine-distribution-drilldown.glb'}
    core.reset();new_materials();shell_bounds,shell_count=shell();cabinet()
    out=Path(args.output_dir)
    report=export(out/'mine-distribution-drilldown.glb',shell_bounds,shell_count)
    for name,h in originals.items():assert hashlib.sha256((ROOT/'public/models'/name).read_bytes()).hexdigest()==h
    report['originalAssetsUnchanged']=len(originals)
    report['assetSha256']=hashlib.sha256((out/report['file']).read_bytes()).hexdigest()
    report['originContract']={'units':'meters','up':'Y','scenePosition':CFG['roomPosition'],
        'cabinetRootRoomPosition':CFG['cabinetPosition'],'independentRecentering':False}
    report_path=out/'mine-distribution-drilldown.report.json'
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('DISTRIBUTION_DRILLDOWN_EXPORT_OK '+json.dumps({k:report[k] for k in ('file','bytes','triangles','meshes','materials','originalAssetsUnchanged')}))


if __name__=='__main__':main()
