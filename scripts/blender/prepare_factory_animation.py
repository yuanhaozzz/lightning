"""One-time semantic preparation. Runtime operations never regenerate GLB.
Existing meters/Y-up anchors and all static shapes are preserved.
Blender -b --factory-startup --python-exit-code 1 --python this_file
"""
import sys, json, math, hashlib
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
import generate_core_production as core
import generate_coal_transport as coal
import generate_power_area as power
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tmp/factory-candidate'
OUT.mkdir(parents=True,exist_ok=True)
BINDINGS={'schemaVersion':1,'units':'meters','up':'Y','hoist':{},'conveyors':[],'outputs':[]}

def pieces():return [o for o in bpy.context.scene.objects if o.type=='MESH']
def tag(objects,key,entity,role,pivot=(0,0,0),axis=(0,0,1),radius=0,extra=None):
    for o in objects:
        o['animationId']=key;o['factoryEntityId']=entity;o['animationRole']=role
        o['animationPivot']=list(pivot);o['animationAxis']=list(axis);o['effectiveRadius']=radius
        if extra:
            for k,v in extra.items():o[k]=v

def export(filename):
    """Batch only one entity + motion group + material. Groups retain pivots."""
    bpy.context.view_layer.update()
    objects=pieces();groups={}
    for o in objects:
        key=o.get('animationId','static');entity=o.get('factoryEntityId','')
        groups.setdefault((key,entity,o.data.materials[0].name),[]).append(o)
    parents={}
    for (key,entity,mat),members in groups.items():
        metadata={k:v for k,v in members[0].items()}
        pivot=metadata.get('animationPivot',[0,0,0])
        if (key,entity) not in parents:
            parent=bpy.data.objects.new(key,None);bpy.context.collection.objects.link(parent)
            parent.location=core.xyz(pivot)
            for k,v in metadata.items():parent[k]=v
            parents[(key,entity)]=parent
        for obj in members:
            if not obj.data.uv_layers:
                uv=obj.data.uv_layers.new(name='UVMap')
                for poly in obj.data.polygons:
                    for loop in poly.loop_indices:
                        p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                        uv.data[loop].uv=(p.x,p.y)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in members:obj.select_set(True)
        bpy.context.view_layer.objects.active=members[0]
        if len(members)>1:bpy.ops.object.join()
        obj=bpy.context.object;obj.name=key+'__'+mat
        bpy.context.view_layer.update();world=obj.matrix_world.copy();parent=parents[(key,entity)]
        obj.parent=parent;bpy.context.view_layer.update();obj.matrix_basis=parent.matrix_world.inverted()@world
        # Semantic metadata belongs to the group, not duplicate mesh entities.
        for k in list(obj.keys()):del obj[k]
    bpy.context.view_layer.update()
    result=bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',export_yup=True,
        export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    assert result=={'FINISHED'}
    tris=sum(len(p.vertices)-2 for o in pieces() for p in o.data.polygons)
    BINDINGS['outputs'].append({'file':filename,'triangles':tris,'bytes':(OUT/filename).stat().st_size,'groups':len(parents)})

cfg=json.loads((ROOT/'scripts/blender/core_production.parameters.json').read_text())
core.materials();core.reset();port,alignment=core.rope_geometry(cfg)
ropePoints=[list(p) for p in core.ROPE_POINTS]
core.reset();core.building('hoist',cfg['hoistHouse'],port);core.hoist_machine(cfg['hoistHouse'],cfg['rope'])
localDrum=list(Vector(cfg['rope']['drumCenter'])-Vector(cfg['hoistHouse']['position']))
rotating=[o for o in pieces() if o.name.startswith(('drum_barrel','drum_flange','drum_axle','brake_disc','drive_coupling'))]
tag(rotating,'hoist-drum','hoist-house-01','rotor',localDrum,radius=1.1)
tag([o for o in pieces() if o.name.startswith(('roof_panel','roof_standing_seam','ridge_flashing'))],
    'hoist-inspection-roof','hoist-house-01','inspection-roof')
tag([o for o in pieces() if o.name.startswith('wound_rope')],'hoist-wound-rope','hoist-house-01','wound-rope')
core.check_new_rope_clearance(cfg,cfg['hoistHouse']['position'])
export('mine-hoist-house.glb')

core.reset();core.ROPE_POINTS.clear();core.rope_geometry(cfg);core.guide_assembly(cfg);core.site_details()
tag([o for o in pieces() if o.name.startswith('active_hoist_rope')],'hoist-rope-fixed','hoist-house-01','rope')
# First vertical segment is replaced with a length-changing runtime rope.
tag([o for o in pieces() if o.name=='active_hoist_rope_0'],'hoist-rope-container-original','hoist-house-01','replace-rope')
for i,c in enumerate(cfg['rope']['guideCenters']):
    rotating=[]
    for o in pieces():
        if not o.name.startswith(('guide_grooved_rim','guide_hub','guide_spoke','guide_axle')):continue
        center=Vector((o.location.x,o.location.z,-o.location.y))
        # Custom grooved meshes have origin zero: distinguish them by vertex centroid.
        if o.name.startswith('guide_grooved_rim'):
            center=sum((o.matrix_world@v.co for v in o.data.vertices),Vector())/len(o.data.vertices)
            center=Vector((center.x,center.z,-center.y))
        if abs(center.x-c[0])<.75:rotating.append(o)
    tag(rotating,f'hoist-guide-{i+1}','hoist-house-01','rotor',c,radius=.65)
core.check_new_rope_clearance(cfg)
export('mine-production-links.glb')
BINDINGS['hoist']={'sheaveId':'headframe-01/sheave','sheaveRadius':1.664,'drumRadius':1.1,'guideRadius':.65,
    'ropePoints':ropePoints,'containerAnchor':[ropePoints[0][0],0,-6],
    'containerHeight':1.55,'lowBottom':.12,'highBottom':1.72,'schematicStroke':True,
    'signs':{'sheave':1,'hoist-drum':-1,'hoist-guide-1':-1,'hoist-guide-2':-1}}

# Small guided inspection skip. No invented deep shaft or underground mine.
core.reset()
core.box('skip_bottom',(0,.10,0),(1.05,.15,1.05),'machine',.015)
for x in (-.5,.5):
    for z in (-.5,.5):core.beam('skip_corner',(x,.15,z),(x,1.28,z),.05,.06,'steel')
for z in (-.5,.5):
    core.box('skip_side',(0,.65,z),(1.02,1.03,.035),'machine')
for x in (-.5,.5):core.box('skip_end',(x,.65,0),(.035,1.03,1.02),'machine')
for x in (-.5,.5):core.beam('skip_yoke',(x,1.25,0),(0,1.48,0),.05,.06,'steel')
core.rod('skip_rope_socket',(0,1.45,0),(0,1.55,0),.055,'machined',12)
tag(pieces(),'hoist-container','hoist-house-01','container')
export('mine-hoist-container.glb')

params=json.loads((ROOT/'scripts/blender/coal_transport.parameters.json').read_text())
coal.materials();core.reset()
originalRod=coal.rod
active=None;serial=0;activeNormal=Vector((0,1,0));activeDirection=Vector((1,0,0))
def animationRod(name,a,b,radius,mat,vertices=16):
    global serial
    before=set(bpy.context.scene.objects);originalRod(name,a,b,radius,mat,vertices)
    objects=list(set(bpy.context.scene.objects)-before)
    if name in ('head_pulley','tail_pulley','head_pulley_axle','tail_pulley_axle'):
        pivot=list((Vector(a)+Vector(b))/2);axis=list((Vector(b)-Vector(a)).normalized())
        # Same center/role merges rotating barrel and shaft by matching prefix.
        tag(objects,active+'/'+name.split('_')[0]+'-pulley',active,'rotor',pivot,axis,.26)
    elif name in ('center_carry_idler','wing_carry_idler','return_idler'):
        serial+=1;axis=list((Vector(b)-Vector(a)).normalized());center=list((Vector(a)+Vector(b))/2)
        sign=1 if Vector(axis).cross(activeNormal).dot(activeDirection)>0 else -1
        tag(objects,active+'/idler-'+str(serial),active,'idler',center,axis,radius,
            {'rotationSign':sign*(-1 if name=='return_idler' else 1)})
coal.rod=animationRod
for item in params['conveyors']:
    active=item['id'];activeDirection=coal.line_frame(item)[4];activeNormal=coal.line_frame(item)[6]
    before=set(bpy.context.scene.objects);coal.conveyor(item,params)
    objects=list(set(bpy.context.scene.objects)-before)
    a,b,start,end,u,v,w,length=coal.line_frame(item)
    for o in objects:
        if 'animationId' in o:continue
        if o.name.startswith((active+'_carrying_belt','return_belt','head_belt_wrap','tail_belt_wrap')):
            role='return-belt' if o.name.startswith('return_belt') else 'belt'
            key=active+'/'+role
            tag([o],key,active,role)
            # A continuous meter coordinate for all longitudinal carrying surfaces.
            uv=o.data.uv_layers.get('UVMap') or o.data.uv_layers.new(name='UVMap')
            bpy.context.view_layer.update()
            for loop in o.data.loops:
                p=o.matrix_world@o.data.vertices[loop.vertex_index].co;p=Vector((p.x,p.z,-p.y))-start
                t=p.dot(u)
                if role=='return-belt':s=2*length+math.pi*.26-t
                elif o.name.startswith('head_belt_wrap'):
                    q=p-u*length+w*.26;s=length+.26*(math.pi/2-math.atan2(q.dot(w),q.dot(u)))
                elif o.name.startswith('tail_belt_wrap'):
                    q=p+w*.26;s=2*length+math.pi*.26+.26*(math.atan2(q.dot(w),-q.dot(u))+math.pi/2)
                else:s=t
                uv.data[loop.index].uv=(s,p.dot(v))
        elif o.name.startswith(('weather_cover','hinged_inspection_cover')):
            tag([o],active+'/covers',active,'inspection-cover')
        else:tag([o],active+'/static',active,'structure')
    BINDINGS['conveyors'].append({'id':active,'start':list(start),'end':list(end),'direction':list(u),
        'across':list(v),'normal':list(w),'length':length,'width':1 if item['width']==1.8 else .9,
        'from':'shaft-house-01' if active=='shaft-transfer' else 'transfer-01',
        'to':'transfer-01' if active=='shaft-transfer' else ('coal-silo-01' if active.endswith('1') else 'coal-silo-02')})
export('mine-coal-conveyors.glb')

# Preserve existing cabinet groups/IDs; only lamps leave their material batch.
power.materials();core.reset();power.ENTITIES.clear()
pconf=json.loads((ROOT/'scripts/blender/power_area.parameters.json').read_text())
power.interior(pconf['cabinet'],pconf['reserves'])
lamps=[o for o in pieces() if o.name.startswith('status_lamp')]
for i,o in enumerate(lamps):
    entity=o['entityId'];tag([o],entity+'/lamp-'+str(i),entity,'status-lamp')
    del o['entityId']
# Same geometry and entities; use existing power exporter for the remaining parts,
# then independent light groups are exported in a separate, aligned asset.
for o in lamps:bpy.data.objects.remove(o,do_unlink=True)
power.export(OUT/'mine-distribution-equipment.glb')
# Equipment itself need not change: original yellow lamps must be removed once,
# while independent lamps are generated at exactly the same centers below.
core.reset()
for row in ('mv','lv'):
    sign=-1 if row=='mv' else 1
    for i in range(pconf['cabinet']['countPerRow']):
        x=(i-(pconf['cabinet']['countPerRow']-1)/2)*pconf['cabinet']['pitch'];z=sign*pconf['cabinet']['rowZ']
        front=z-sign*(pconf['cabinet']['depth']/2+.015)
        for index,dx in enumerate((-.17,0,.17)):
            before=set(bpy.context.scene.objects)
            core.rod('status_indicator',(x+dx,.31+1.61,front),(x+dx,.31+1.61,front-sign*.055),.025,'safety',8)
            entity=f'power-cabinet-{row}-{i+1:02d}'
            tag(list(set(bpy.context.scene.objects)-before),entity+'/lamp-'+str(index),entity,'status-lamp',
                extra={'lampIndex':index})
export('mine-power-indicators.glb')
BINDINGS['silos']=params['silos']
# Reusable coal source; one shared low-poly primitive is instanced at runtime.
core.reset()
coalMat=core.primitives.material('Maintained_coal',(.022,.025,.026),0,.91)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1)
rock=bpy.context.object;rock.name='coal-prototype';rock.scale=(.11,.08,.065)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
core.primitives.finish(rock,'coal-prototype',coalMat)
tag([rock],'coal-prototype','coal-flow','prototype')
export('mine-coal-material.glb')
BINDINGS['outputs'].append({'file':'mine-distribution-equipment.glb','bytes':(OUT/'mine-distribution-equipment.glb').stat().st_size})
(OUT/'mine-factory-animation.bindings.json').write_text(json.dumps(BINDINGS,indent=2))
print('FACTORY_EXPORT_OK '+json.dumps(BINDINGS['outputs']))
