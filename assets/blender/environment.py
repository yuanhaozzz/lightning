"""Original AEROTWIN v0.1 airport environment; metres, browser Y-up input.

Built exclusively with project-owned mesh geometry.  Call begin_asset before
each build_* function; helpers only add to that project's active collection.
Terminal is an original segment, and apron markings are illustrative, not a
certified airport layout.  Every articulated bridge/vehicle part has a named
group and an explicit pivot metadata field for later rigging.
"""
import bpy
import math
import random
import json
from pathlib import Path
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from common import box, coord, cylinder, curve, empty, material, mesh, attach

ASSET_VERSION = '0.2.0'
TERMINAL_FACADE_X = 24.0  # Port-side building face, beyond the complete wing span.
TERMINAL_Z_OFFSET = -16.0  # Rotate the authored 62 m facade to run along aircraft Z.


def batch_static(root_object):
    """Join static siblings by material, retaining every articulated group.

    All bevels are evaluated before joining.  Each result retains the source
    part names in metadata so repeatable parts stay identifiable in Blender.
    Tyre/hub groups and bridge articulation groups remain separate empties.
    """
    groups=[root_object]+[obj for obj in root_object.children_recursive if obj.type=='EMPTY']
    for group in groups:
        buckets={}
        for obj in list(group.children):
            if obj.type not in ('MESH','CURVE','FONT'):
                continue
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active=obj
            if obj.type!='MESH' or len(obj.modifiers):
                bpy.ops.object.convert(target='MESH')
                obj=bpy.context.object
            key=tuple(slot.material.name if slot.material else '' for slot in obj.material_slots)
            buckets.setdefault(key,[]).append(obj)
        for key,objects in buckets.items():
            if len(objects)<2:
                continue
            sources=[obj.name for obj in objects]
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:obj.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            bpy.ops.object.join()
            joined=bpy.context.object
            joined.name=group.name+'_'+key[0].removeprefix('AT_')+'_batch'
            joined['sourcePartNames']=json.dumps(sources)
            # A rotated diagonal brace must not become the local axis system
            # of an entire tunnel: its transformed local AABB would overstate
            # height by several metres even though actual vertices are correct.
            bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    return root_object


def root(name, description):
    obj = empty(name)
    obj['assetVersion'] = ASSET_VERSION
    obj['unit'] = 'metre'
    obj['browserUp'] = '+Y'
    obj['description'] = description
    return obj


def glass_material(name='Architectural_glass', color=(.29, .43, .47, 1)):
    mat = material(name, color, metallic=.32, roughness=.19)
    shader=mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Coat Weight'].default_value = .28
    if name in ('Architectural_glass','Glass_sky_reflection','Bridge_glass'):
        shader.inputs['Alpha'].default_value=.68
        mat.diffuse_color=(*mat.diffuse_color[:3],.68)
        mat.surface_render_method='DITHERED'
    return mat


def lettering(name, text, position, size, mat, parent, u=(1, 0, 0), v=(0, 1, 0)):
    """Extruded, editable-source signage converted to glTF-compatible mesh."""
    font = bpy.data.curves.new(name + '_source', 'FONT')
    font.body = text
    font.align_x = 'CENTER'
    font.align_y = 'CENTER'
    font.size = size
    font.extrude = .001
    font.resolution_u = 4
    font.materials.append(mat)
    obj = bpy.data.objects.new(name, font)
    bpy.context.scene.collection.objects.link(obj)
    uu, vv = coord(u).normalized(), coord(v).normalized()
    nn = uu.cross(vv).normalized()
    obj.matrix_world = Matrix(((uu.x, vv.x, nn.x, 0),
                               (uu.y, vv.y, nn.y, 0),
                               (uu.z, vv.z, nn.z, 0), (0, 0, 0, 1)))
    obj.location = coord(position)
    attach(obj, parent)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def oriented_box(name, a, b, width, height, mat, parent, y_offset=0):
    """A closed prism aligned along its two centreline endpoints."""
    aa, bb = Vector(a), Vector(b)
    direction = bb - aa
    side = Vector((direction.z, 0, -direction.x)).normalized() * width / 2
    up = Vector((0, height / 2, 0))
    lift = Vector((0, y_offset, 0))
    verts = [tuple(p + lift + s * side + t * up)
             for p in (aa, bb) for s, t in ((-1,-1),(1,-1),(1,1),(-1,1))]
    return mesh(name, verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                             (1,2,6,5),(2,3,7,6),(3,0,4,7)], mat, parent)


def build_terminal():
    terminal = root('Terminal_A21_ROOT', 'Original port-side terminal segment, facade faces -X')
    terminal['facadePlaneX_m'] = TERMINAL_FACADE_X
    terminal['bounds_m'] = [24, 0, -30, 37, 12.2, 32]
    pale = material('Terminal_limestone', (.65,.66,.64,1), roughness=.83)
    trim = material('Powder_coated_aluminium', (.55,.59,.60,1), metallic=.55, roughness=.32)
    frame = material('Curtainwall_mullions', (.17,.23,.25,1), metallic=.65, roughness=.29)
    glazing = glass_material()
    glazing_alt = glass_material('Glass_sky_reflection', (.39,.52,.56,1))
    dark = material('Interior_shadows', (.12,.16,.18,1), roughness=.9)
    light = material('Terminal_interior_wall', (.48,.47,.42,1), roughness=.82)
    yellow = material('Gate_sign_yellow', (.88,.64,.13,1), roughness=.5)
    ink = material('Sign_charcoal', (.035,.052,.065,1), roughness=.62)
    structure = empty('Terminal_structure', terminal)
    facade = empty('Terminal_curtain_wall', terminal)
    interior = empty('Terminal_simplified_interior', terminal)
    # Solid backing, two floor plates and recessed gallery retain depth.
    box('Terminal_rear_wall', (-17,5.8,42.7), (62,11.6,.6), pale, structure)
    box('Terminal_side_wall_west', (-47.8,5.6,36.3), (.4,11.2,13), pale, structure)
    box('Terminal_interior_wall', (-17,5.4,38), (60,10.4,.3), light, interior)
    for y in (.15,3.25,7.05,11.35):
        box('Terminal_floor_plate_%.2f' % y, (-17,y,36.5), (62,.3,13), pale, structure)
        box('Terminal_front_fascia_%.2f' % y, (-17,y+.12,29.78), (62.1,.48,.72), trim, structure)
    box('Terminal_roof', (-17,11.85,36.4), (64,.65,14.8), pale, structure, bevel=.06)
    box('Terminal_roof_drip_edge', (-17,11.57,28.98), (64,.14,.18), trim, structure)
    for x in range(-46,15,6):
        box('Terminal_structural_column_%d' % x, (x,5.65,30.55), (.38,11.1,.48), pale, structure)
        box('Terminal_interior_column_%d' % x, (x,5.4,36.2), (.35,10.5,.35), light, interior)
    # Each bay is recessed; all surfaces are closed and visible from behind.
    panel_width = 2.95
    for index in range(21):
        x = -46.5 + index * 2.95
        for row,(low,high) in enumerate(((.45,3.0),(3.65,6.75),(7.45,11.05))):
            y=(low+high)/2
            box('Glazing_%02d_%d' % (index,row), (x,y,30.05), (panel_width-.11,high-low,.09),
                glazing_alt if (index+row)%5 == 0 else glazing, facade)
            box('Mullion_%02d_%d' % (index,row), (x+panel_width/2,y,29.97), (.07,high-low+.12,.14), frame, facade)
            box('Transom_%02d_%d' % (index,row), (x,y+.12,29.94), (panel_width,.045,.16), frame, facade)
            # Warm interior recess behind the glazing provides actual volume.
            box('Interior_recess_%02d_%d' % (index,row), (x,y,34.8), (2.8,high-low,.18), dark, interior)
    # Glazed return on the visible east wall.
    for index in range(4):
        z=31.7+index*2.8
        box('East_return_glass_%d' % index, (13.95,7.3,z), (.1,7.5,2.68), glazing, facade)
        box('East_return_mullion_%d' % index, (14.02,7.3,z+1.4), (.15,7.6,.07), frame, facade)
    box('East_return_corner', (14,5.7,30.04), (.28,11.4,.28), trim, structure)
    # Landside service zone below gate level, not a fully modelled interior.
    for x in (-35,-20,-5):
        box('Ground_service_door_%.0f'%x,(x,1.35,29.94),(2.3,2.4,.15), dark, structure)
        for k in range(8):
            box('Service_door_louvre_%s_%s'%(x,k),(x,.42+k*.27,29.84),(2.15,.045,.045),trim,structure)
    box('Gate_A21_sign_back', (10.2,8.8,29.63), (3.8,2.2,.22), ink, structure, bevel=.05)
    box('Gate_A21_sign_face', (10.2,8.8,29.49), (3.55,1.96,.035), yellow, structure)
    lettering('Gate_A21_letters','A21',(10.2,8.75,29.455),1.58,ink,structure,
              u=(-1,0,0),v=(0,1,0))
    # Rooftop plant volumes with repeating louvres; no extra control tower.
    for x in (-31,-12):
        box('Roof_air_handler_%.0f'%x,(x,12.15,38.2),(6,.6,2.7),trim,structure,bevel=.06)
        for k in range(10):
            box('Roof_louvre_%s_%s'%(x,k),(x-2.6+k*.57,12.49,38.2),(.2,.05,2.4),frame,structure)
    context=empty('Terminal_distant_original_hangars',terminal)
    hangar_wall=material('Distant_hangar_cladding',(.32,.37,.39,1),metallic=.18,roughness=.7)
    hangar_footing=material('Distant_hangar_concrete_footing',(.23,.25,.24,1),roughness=.96)
    # Distant context is authored directly in world space and is deliberately
    # excluded from the main terminal's rotation/translation below.
    for index,(final_x,y,z,w,h,d) in enumerate(((-55,3,-115,45,6,20),(5,4,-140,55,8,18))):
        x=final_x
        # The runtime horizon is Y=-0.28, whereas the main stand top is Y=0.
        # A low footing bridges this level difference; its bottom sits below
        # the horizon and its top overlaps the shell so no daylight gap shows.
        box('Distant_hangar_%d_ground_footing'%index,(x,-.16,z),(w+.6,.4,d+.6),hangar_footing,context)
        box('Distant_hangar_%d_shell'%index,(x,y,z),(w,h,d),hangar_wall,context,bevel=.08)
        box('Distant_hangar_%d_roof'%index,(x,h+.12,z),(w+.8,.24,d+.8),trim,context)
        box('Distant_hangar_%d_upper_glazing'%index,(x,h*.79,z+d/2+.02),(w-.8,.72,.035),glazing,context)
        for j in range(6):
            xx=x-w*.42+j*w*.168
            box('Distant_hangar_%d_door_joint_%d'%(index,j),(xx,h*.38,z+d/2+.03),(.05,h*.72,.04),frame,context)
    terminal=batch_static(terminal)
    distant_meshes=set(context.children_recursive)
    transform=Matrix.Translation(coord((TERMINAL_FACADE_X-30,0,TERMINAL_Z_OFFSET))) @ Matrix.Rotation(math.pi/2,4,'Z')
    for obj in terminal.children_recursive:
        if obj.type=='MESH' and obj not in distant_meshes:
            obj.matrix_world=transform@obj.matrix_world
    bpy.context.view_layer.update()
    return terminal


def build_bridge():
    bridge = root('PassengerBridge_A21_ROOT', 'Static telescopic bridge; L1 threshold 3.4 m')
    bridge['doorContact_m'] = [1.98,4.325,13.5]
    bridge['doorSill_m'] = 3.4
    white = material('Bridge_painted_panels', (.68,.70,.68,1), metallic=.22, roughness=.45)
    frame = material('Bridge_structural_steel', (.29,.36,.38,1), metallic=.65, roughness=.36)
    glass = glass_material('Bridge_glass', (.25,.40,.43,1))
    rubber = material('Bridge_bellows_rubber', (.055,.065,.067,1), roughness=.86)
    tread = material('Bridge_floor_tread', (.15,.18,.19,1), metallic=.4, roughness=.66)
    chrome = material('Hydraulic_rod', (.59,.64,.66,1), metallic=.9, roughness=.23)
    fixed = empty('Bridge_fixed_rotunda_PIVOT',bridge)
    fixed['pivot_m']=[14,4.7,13.5]
    cylinder('Rotunda_floor',(14,3.25,13.5),(14,3.5,13.5),1.72,white,fixed,vertices=32)
    cylinder('Rotunda_roof',(14,6.05,13.5),(14,6.22,13.5),1.8,white,fixed,vertices=32)
    for n in range(12):
        angle=2*math.pi*n/12
        a=(14+1.62*math.cos(angle),4.77,13.5+1.62*math.sin(angle))
        b=(14+1.62*math.cos(angle+math.pi/6),4.77,13.5+1.62*math.sin(angle+math.pi/6))
        oriented_box('Rotunda_glazing_%02d'%n,a,b,.055,2.45,glass,fixed)
        cylinder('Rotunda_mullion_%02d'%n,(a[0],3.5,a[2]),(a[0],6.05,a[2]),.045,frame,fixed,12)
    for x in (12.8,15.2):
        box('Fixed_pier_%s'%x,(x,1.6,13.5),(.36,3.2,.36),white,fixed)
        box('Fixed_pier_foot_%s'%x,(x,.09,13.5),(.75,.18,.7),frame,fixed,bevel=.03)

    def tunnel(name,a,b,width):
        group=empty(name,bridge)
        group['translationAxis_m']=list((Vector(b)-Vector(a)).normalized())
        group['pivot_m']=list(a)
        oriented_box(name+'_floor',a,b,width,.22,tread,group,y_offset=-1.14)
        oriented_box(name+'_underframe',a,b,width+.1,.21,white,group,y_offset=-1.32)
        oriented_box(name+'_roof',a,b,width+.12,.18,white,group,y_offset=1.27)
        direction=Vector(b)-Vector(a)
        side=Vector((direction.z,0,-direction.x)).normalized()
        for sign in (-1,1):
            offset=side*sign*width/2
            aa,bb=Vector(a)+offset,Vector(b)+offset
            oriented_box(name+'_glazed_side_%s'%sign,aa,bb,.065,1.72,glass,group,y_offset=.12)
            oriented_box(name+'_lower_panel_%s'%sign,aa,bb,.095,.48,white,group,y_offset=-.98)
            oriented_box(name+'_upper_header_%s'%sign,aa,bb,.11,.15,white,group,y_offset=1.15)
            count=max(3,round(direction.length/1.35))
            for k in range(count+1):
                p=aa.lerp(bb,k/count)
                cylinder(name+'_vertical_%s_%s'%(sign,k),p+Vector((0,-1.1,0)),p+Vector((0,1.17,0)),.045,frame,group,12)
                if k<count:
                    q=aa.lerp(bb,(k+1)/count)
                    # Slender alternating diagonals retain a recognisable industrial truss.
                    cylinder(name+'_brace_%s_%s'%(sign,k),p+Vector((0,-.73 if k%2 else 1,0)),q+Vector((0,1 if k%2 else -.73,0)),.032,frame,group,10)
        return group

    fixed_corridor=tunnel('Bridge_fixed_elevated_corridor',(24,4.65,20),(18,4.65,20),2.65)
    fixed_corridor['stationary']=True
    corner_corridor=tunnel('Bridge_fixed_corner_corridor',(18,4.65,20),(14,4.65,13.5),2.65)
    corner_corridor['stationary']=True
    # Elbow supports clear the nose and the ground equipment waiting bays.
    for x,z in ((23,20),(18,20)):
        for side in (-1,1):
            pz=z+side*.84
            box('Fixed_corridor_column_%s_%s'%(x,side),(x,1.64,pz),(.24,3.28,.28),frame,fixed_corridor)
            box('Fixed_corridor_base_%s_%s'%(x,side),(x,.08,pz),(.58,.16,.62),white,fixed_corridor,bevel=.03)
    tunnel('Bridge_outer_tunnel', (14,4.65,13.5),(8,4.65,13.5),2.65)
    tunnel('Bridge_inner_telescopic_tunnel', (8.45,4.65,13.5),(3.3,4.65,13.5),2.43)
    # The rotating cabin changes heading so its final opening is normal to
    # the aircraft centreline, rather than driving a diagonal tunnel through it.
    cab=empty('Bridge_rotating_docking_cab_PIVOT',bridge)
    cab['pivot_m']=[3.55,4.65,13.5]
    box('Docking_cab_floor',(3.28,3.39,13.5),(2.25,.18,2.65),tread,cab,bevel=.04)
    box('Docking_cab_roof',(3.28,6.04,13.5),(2.35,.16,2.78),white,cab,bevel=.07)
    for z in (12.22,14.78):
        box('Docking_cab_side_%s'%z,(3.3,4.7,z),(2.1,2.45,.12),white,cab,bevel=.05)
        box('Cab_operator_window_%s'%z,(3.72,5.05,z-.068 if z<13.5 else z+.068),(.9,.82,.025),glass,cab,bevel=.04)
    box('Cab_back_panel',(4.36,4.7,13.5),(.13,2.48,2.6),white,cab)
    # Multiple rubber folds around an open centre leave the doorway visible.
    bellows_rings=[]
    for k in range(9):
        t=k/8
        width=1.1+.15*k/8
        top=5.65+.28*t
        bottom=3.43
        # The first fold follows the actual fuselage cross-section.  Each
        # subsequent fold progressively opens toward the rectangular cab.
        lower_x=1.87+(2.53-1.87)*t
        middle_x=1.995+(2.53-1.995)*t
        upper_x=1.37+(2.53-1.37)*t
        ring=[(lower_x,bottom,13.5-width),
              (middle_x,4.325,13.5-width),(upper_x,top,13.5-width),
              (upper_x,top,13.5+width),(middle_x,4.325,13.5+width),
              (lower_x,bottom,13.5+width)]
        bellows_rings.append(ring)
        curve('Dock_bellows_fold_%02d'%k,ring,.043,rubber,cab)
    mesh('Dock_bellows_continuous_weather_seal',[point for ring in bellows_rings for point in ring],
         [(k*6+j,k*6+j+1,(k+1)*6+j+1,(k+1)*6+j) for k in range(8) for j in range(5)],rubber,cab)
    box('Door_threshold_lip',(2.08,3.40,13.5),(.48,.065,1.05),tread,cab)
    # Mobile support is planted on real tyre radii. The upper support remains
    # beneath the bridge floor, not in the aircraft or an equipment lane.
    support=empty('Bridge_mobile_support_PIVOT',bridge)
    support['pivot_m']=[7,0,13.5]
    box('Bridge_bogie',(7,.73,13.5),(1.15,.4,3.9),frame,support,bevel=.09)
    for z in (12.1,14.9):
        cylinder('Bridge_jack_outer_%s'%z,(7,.9,z),(7,2.7,z),.16,white,support)
        cylinder('Bridge_jack_piston_%s'%z,(7,2.5,z),(7,3.38,z),.1,chrome,support)
        for x in (6.57,7.43):
            wheel=empty('Bridge_wheel_%s_%s'%(x,z),support)
            wheel['rotationAxis']='+Z'
            cylinder('Support_tyre_%s_%s'%(x,z),(x,.46,z-.23),(x,.46,z+.23),.46,rubber,wheel,32)
            cylinder('Support_hub_%s_%s'%(x,z),(x,.46,z-.24),(x,.46,z+.24),.24,white,wheel,24)
    box('Bridge_electrical_cabinet',(7,1.47,15.4),(.76,1.12,.62),white,support,bevel=.04)
    # Underfloor service ducts and a folded service ladder are visible details.
    cylinder('Bridge_fixed_service_duct',(23.8,3.03,20),(18,3.03,20),.10,frame,bridge)
    cylinder('Bridge_corner_service_duct',(18,3.03,20),(13.8,3.03,13.5),.10,frame,bridge)
    cylinder('Bridge_underfloor_service_duct',(13.8,3.03,13.5),(4.2,3.03,13.5),.10,frame,bridge)
    for k in range(8):
        box('Bridge_ladder_rung_%d'%k,(7.75,.35+k*.35,14.1),(.06,.04,.65),chrome,support)
    for z in (13.74,14.46):
        box('Bridge_ladder_rail_%s'%z,(7.75,1.58,z),(.065,2.8,.045),chrome,support)
    return batch_static(bridge)


def build_apron():
    apron=root('Apron_A21_ROOT','200 m concrete apron with illustrative A21 markings')
    apron['markingsStatus']='Demonstration layout; not aerodrome-standard certified'
    joint=material('Concrete_joint',(.12,.135,.13,1),roughness=.96)
    yellow=material('Apron_marking_yellow',(.72,.50,.075,1),roughness=.86)
    red=material('Apron_safety_red',(.54,.16,.13,1),roughness=.87)
    ink=material('Apron_stencil_charcoal',(.14,.17,.18,1),roughness=.9)
    box('Apron_subbase',(0,-.14,0),(200,.26,200),joint,apron)
    rng=random.Random(321)
    shades=[material('Concrete_slab_%02d'%i,(.22+i*.009,.225+i*.009,.215+i*.008,1),roughness=.91) for i in range(7)]
    # An original, deterministic 1K texture is generated and packed into the
    # .blend, then embedded in GLB. No downloaded texture or external file is
    # required. Fine grain and broad low-amplitude patches reduce flatness.
    image_name='AT_Concrete_Original_Grain_1K'
    grain_image=bpy.data.images.get(image_name)
    if grain_image:bpy.data.images.remove(grain_image)
    grain_image=bpy.data.images.new(image_name,width=1024,height=1024,alpha=False)
    grain_image.colorspace_settings.name='sRGB'
    texture_rng=np.random.default_rng(32021)
    xx,yy=np.meshgrid(np.arange(1024,dtype=np.float32),np.arange(1024,dtype=np.float32))
    base=.57 + texture_rng.normal(0,.012,(1024,1024)).astype(np.float32)
    base+=.009*np.sin(xx*math.tau/1024*3+.7)*np.cos(yy*math.tau/1024*2)
    base+=.007*np.sin(xx*math.tau/1024*11)*np.sin(yy*math.tau/1024*7+.4)
    # Broad, soft patches and short wheel smears change albedo by only a few
    # percent. They live in the original texture instead of hard black lines
    # or opaque polygon decals sitting on the pavement.
    wear=np.zeros((1024,1024),dtype=np.float32)
    for px,py,sx,sy,strength in ((230,310,145,62,.65),(730,780,98,160,.5),(510,480,180,74,.35)):
        wear+=strength*np.exp(-(((xx-px)/sx)**2+((yy-py)/sy)**2))
    smears=(np.exp(-((xx-702)/9)**2)+np.exp(-((xx-749)/9)**2))*np.exp(-((yy-505)/200)**6)
    wear=np.clip(wear+.25*smears,0,1)
    base-=.014*wear
    pixels=np.ones((1024,1024,4),dtype=np.float32)
    pixels[:,:,0]=np.clip(base*1.015,0,1)
    pixels[:,:,1]=np.clip(base,0,1)
    pixels[:,:,2]=np.clip(base*.96,0,1)
    grain_image.pixels.foreach_set(pixels.ravel())
    grain_image.file_format='PNG'
    grain_image.pack()
    rough_name='AT_Concrete_Original_Roughness_1K'
    rough_image=bpy.data.images.get(rough_name)
    if rough_image:bpy.data.images.remove(rough_image)
    rough_image=bpy.data.images.new(rough_name,width=1024,height=1024,alpha=False)
    rough_image.colorspace_settings.name='Non-Color'
    rough_pixels=np.ones((1024,1024,4),dtype=np.float32)
    rough_value=np.clip(.955-.045*wear+texture_rng.normal(0,.005,(1024,1024)),.89,.98)
    rough_pixels[:,:,:3]=rough_value[:,:,None]
    rough_image.pixels.foreach_set(rough_pixels.ravel())
    rough_image.file_format='PNG'
    rough_image.pack()
    for i,slab_mat in enumerate(shades):
        tree=slab_mat.node_tree
        node=slab_mat.node_tree.nodes.get('Original_concrete_1K') or slab_mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.name='Original_concrete_1K'
        node.image=grain_image
        node.extension='REPEAT'
        # Blender 5.2's glTF exporter explicitly recognises RGBA Mix Multiply
        # with Factor=1 and emits the constant as pbr.baseColorFactor. Merely
        # setting the BSDF fallback color would be lost once an image is linked.
        tint=tree.nodes.get('Concrete_slab_tint') or tree.nodes.new('ShaderNodeMix')
        tint.name='Concrete_slab_tint';tint.data_type='RGBA';tint.blend_type='MULTIPLY'
        tint.inputs[0].default_value=1
        tint.inputs[7].default_value=(.82+i*.027,.825+i*.026,.80+i*.026,1)
        tree.links.new(node.outputs['Color'],tint.inputs[6])
        tree.links.new(tint.outputs[2],tree.nodes['Principled BSDF'].inputs['Base Color'])
        rough_node=tree.nodes.get('Original_roughness_1K') or tree.nodes.new('ShaderNodeTexImage')
        rough_node.name='Original_roughness_1K';rough_node.image=rough_image;rough_node.extension='REPEAT'
        channels=tree.nodes.get('Concrete_roughness_channel') or tree.nodes.new('ShaderNodeSeparateColor')
        channels.name='Concrete_roughness_channel'
        tree.links.new(rough_node.outputs['Color'],channels.inputs['Color'])
        rough_mul=tree.nodes.get('Concrete_slab_roughness_factor') or tree.nodes.new('ShaderNodeMath')
        rough_mul.name='Concrete_slab_roughness_factor';rough_mul.operation='MULTIPLY'
        rough_mul.inputs[1].default_value=.94+((i*3)%7)*.008
        tree.links.new(channels.outputs['Green'],rough_mul.inputs[0])
        tree.links.new(rough_mul.outputs[0],tree.nodes['Principled BSDF'].inputs['Roughness'])
    # Build seven mesh batches rather than hundreds of independent slab draws.
    buffers=[([],[]) for _ in shades]
    pitch=5.55
    for ix in range(-18,18):
        for iz in range(-18,18):
            x,z=(ix+.5)*pitch,(iz+.5)*pitch
            half=pitch/2-.018
            index=rng.randrange(len(shades)); verts,faces=buffers[index]; n=len(verts)
            verts.extend([(x-half,0,z-half),(x-half,0,z+half),(x+half,0,z+half),(x+half,0,z-half)])
            faces.append((n,n+1,n+2,n+3))
    for i,(verts,faces) in enumerate(buffers):
        slab=mesh('Concrete_slab_batch_%02d'%i,verts,faces,shades[i],apron)
        uv=slab.data.uv_layers.new(name='Original_concrete_scale_11m')
        for poly in slab.data.polygons:
            for loop in poly.loop_indices:
                v=slab.data.vertices[slab.data.loops[loop].vertex_index].co
                uv.data[loop].uv=(v.x/11.1+i*.173,v.y/11.1+i*.317)
    markings=empty('Apron_demonstration_markings',apron)
    box('A21_stand_lead_in',(0,.006,-31),( .16,.012,94),yellow,markings)
    for z in (15.2,16.2):box('A21_stop_bar_%s'%z,(0,.008,z),(2.6,.014,.18),yellow,markings)
    # Secondary thin outlines retain visual hierarchy against the lead-in.
    for x in (-22,22):box('Stand_safety_side_%s'%x,(x,.005,-2),(.12,.01,52),red,markings)
    box('Stand_safety_head',(0,.005,24),(44,.01,.12),red,markings)
    box('Stand_safety_tail',(0,.005,-28),(44,.01,.12),red,markings)
    box('Stand_stencil_panel',(0,.008,21.7),(3.6,.012,2.6),yellow,markings)
    lettering('Apron_A21_stencil','A21',(0,.02,21.7),1.45,ink,markings,u=(1,0,0),v=(0,0,-1))
    for x,z,half_length in ((-28,12.8,4.1),(-34,18,2.5),(21,5,3.3)):
        for dx in (-2.2,2.2):box('Waiting_bay_%s_%s'%(x,dx),(x+dx,.007,z),(.12,.012,half_length*2),yellow,markings)
        for end_z in (z-half_length,z+half_length):box('Waiting_bay_end_%s_%s'%(x,end_z),(x,.007,end_z),(4.4,.012,.12),yellow,markings)
    # Grain, local wear and faint paired tyre smears are packed in the shared
    # albedo/roughness images above; no raised black stripe geometry is needed.
    return batch_static(apron)


def build_vehicles():
    vehicles=root('GroundEquipment_A21_ROOT','V0.2 rigged baggage tractor and first cart; parked second cart and pushback')
    vehicles['assetVersion']='0.2.0'
    white=material('GSE_white_paint',(.73,.74,.71,1),metallic=.1,roughness=.45)
    dark=material('GSE_chassis',(.055,.072,.08,1),metallic=.35,roughness=.7)
    rubber=material('GSE_tyre',(.032,.041,.045,1),roughness=.92)
    steel=material('GSE_galvanised_steel',(.48,.53,.54,1),metallic=.8,roughness=.4)
    blue=material('GSE_muted_blue',(.19,.31,.38,1),metallic=.22,roughness=.44)
    glass=glass_material('GSE_cab_glass',(.11,.22,.27,1))
    amber=material('GSE_amber_lamp',(.96,.42,.045,1),roughness=.3)
    yellow=material('GSE_hazard_yellow',(.91,.67,.13,1),roughness=.6)
    red=material('GSE_red_tail_lamp',(.5,.045,.025,1),roughness=.3)

    def wheel(parent,name,x,y,z,radius,width=.22):
        group=empty(name+'_axle_PIVOT',parent)
        group['pivot_m']=[x,y,z];group['pivot_browser']=[x,y,z];group['rotationAxis']='+X'
        group['radius_m']=radius;group['width_m']=width
        cylinder(name+'_tyre',(x-width/2,y,z),(x+width/2,y,z),radius,rubber,group,32)
        cylinder(name+'_rim',(x-width/2-.008,y,z),(x+width/2+.008,y,z),radius*.55,steel,group,24)
        cylinder(name+'_hub',(x-width/2-.02,y,z),(x+width/2+.02,y,z),radius*.23,dark,group,16)
        return group

    # Heavy, low, broad pushback tractor, parked separate from the aircraft.
    tug=empty('PushbackTractor_ROOT',vehicles);tug['parkedPosition_m']=[21,0,5]
    tug['pivot_browser']=[15,0,22]
    cx,cz=15,22
    box('Pushback_chassis',(cx,.71,cz),(2.65,.43,4.95),dark,tug,bevel=.14)
    box('Pushback_body',(cx,1.08,cz),(2.85,.65,4.9),white,tug,bevel=.19)
    box('Pushback_hood',(cx,1.46,cz-1.03),(2.7,.3,2.55),white,tug,bevel=.13)
    box('Pushback_cab_lower',(cx,1.53,cz+.85),(2.28,.56,1.63),white,tug,bevel=.1)
    box('Pushback_cab_roof',(cx,2.45,cz+.85),(2.4,.15,1.85),white,tug,bevel=.07)
    for x in (cx-1.08,cx+1.08):
        for z in (cz+.08,cz+1.58):box('Pushback_cab_post_%s_%s'%(x,z),(x,2.05,z),(.095,.78,.095),white,tug)
        box('Pushback_side_window_%s'%x,(x,2.05,cz+.84),(.035,.66,1.32),glass,tug,bevel=.025)
        box('Pushback_door_handle_%s'%x,(x+(.03 if x>cx else -.03),1.7,cz+.6),(.055,.04,.22),dark,tug)
        box('Pushback_access_step_%s'%x,(x+(.2 if x>cx else -.2),.58,cz+.85),(.28,.12,1.2),steel,tug,bevel=.025)
    for z in (cz+.03,cz+1.66):box('Pushback_windscreen_%s'%z,(cx,2.05,z),(2.04,.66,.045),glass,tug,bevel=.035)
    for x in (cx-1.38,cx+1.38):
        for z in (cz-1.55,cz+1.48):wheel(tug,'Pushback_wheel_%s_%s'%(x,z),x,.57,z,.57,.33)
    for z in (cz-2.5,cz+2.5):
        box('Pushback_bumper_%s'%z,(cx,.72,z),(2.9,.33,.15),dark,tug,bevel=.06)
        for x in (cx-.94,cx+.94):box('Pushback_headlamp_%s_%s'%(x,z),(x,1.13,z),( .36,.23,.05),white if z>cz else red,tug,bevel=.025)
        box('Pushback_tow_coupler_%s'%z,(cx,.55,z+(.14 if z>cz else -.14)),(.3,.21,.38),steel,tug,bevel=.04)
    for k in range(8):box('Pushback_engine_vent_%d'%k,(cx-.72+k*.2,1.63,cz-1.1),(.09,.015,1.18),dark,tug)
    cylinder('Pushback_roof_beacon',(cx,2.53,cz+.82),(cx,2.73,cz+.82),.11,amber,tug,20)
    for x in (cx-1.44,cx+1.44):
        cylinder('Pushback_mirror_stalk_%s'%x,(x,2.14,cz+1.34),(x,2.34,cz+1.5),.025,steel,tug,10)
        box('Pushback_mirror_%s'%x,(x,2.32,cz+1.53),(.13,.23,.05),dark,tug,bevel=.02)

    # Compact baggage tractor: short hood, raised operator cabin and tow hitch.
    baggage=empty('BaggageTractor_ROOT',vehicles);baggage['parkedPosition_m']=[-28,0,14]
    baggage['pivot_browser']=[-13,0,22.09]
    baggage['root_reference']='rear axle ground point; +Z forward; +Y up'
    bx,bz=-13,23
    box('Baggage_chassis',(bx,.49,bz),(1.45,.27,2.8),dark,baggage,bevel=.06)
    box('Baggage_front_hood',(bx,.96,bz+.76),(1.42,.61,1.22),white,baggage,bevel=.1)
    box('Baggage_operator_base',(bx,.97,bz-.52),(1.4,.57,1.2),white,baggage,bevel=.05)
    box('Baggage_roof',(bx,2.16,bz-.46),(1.54,.12,1.44),white,baggage,bevel=.06)
    for x in (bx-.67,bx+.67):
        for z in (bz-1.05,bz+.11):box('Baggage_cab_post_%s_%s'%(x,z),(x,1.68,z),(.07,.9,.07),white,baggage)
        box('Baggage_side_glass_%s'%x,(x,1.72,bz-.47),(.035,.72,1.03),glass,baggage,bevel=.02)
        for z in (bz-.91,bz+.92):
            axle='Front' if z>bz else 'Rear';side='PosX' if x>bx else 'NegX'
            label='BaggageTractor_'+axle+'_'+side
            parent=baggage
            if axle=='Front':
                parent=empty(label+'_Steer',baggage)
                parent['pivot_browser']=[x,.37,z];parent['rotationAxis']='+Y'
            roll=wheel(parent,label,x,.37,z,.37,.22)
            roll.name=label+'_Roll'
    for z in (bz-1.09,bz+.15):box('Baggage_windscreen_%s'%z,(bx,1.73,z),(1.23,.73,.035),glass,baggage,bevel=.02)
    box('Baggage_grille',(bx,.94,bz+1.39),(1.02,.34,.045),dark,baggage,bevel=.02)
    for x in (bx-.55,bx+.55):box('Baggage_headlight_%s'%x,(x,1.2,bz+1.4),(.2,.16,.05),white,baggage,bevel=.025)
    cylinder('Baggage_beacon',(bx,2.23,bz-.5),(bx,2.39,bz-.5),.09,amber,baggage,16)
    box('Baggage_tow_hitch',(bx,.4,bz-1.53),(.2,.14,.38),steel,baggage,bevel=.03)
    carts=[]
    for i,z in enumerate((18.9,14.75)):
        cart=empty('BaggageCart_%d_ROOT'%(i+1),vehicles);carts.append(cart)
        cart['parkedPosition_m']=[-28,0,9.76] if i==0 else [-34,0,18]
        cart['pivot_browser']=[bx,0,z-1.05] if i==0 else [bx,0,z]
        cart['root_reference']='rear axle ground point' if i==0 else 'static body centre ground point'
        bogie=None
        if i==0:
            bogie=empty('BaggageCart_1_FrontBogie',cart)
            bogie['pivot_browser']=[bx,0,z+1.05];bogie['rotationAxis']='+Y'
            box('BaggageCart_1_BogieFrame',(bx,.42,z+1.05),(1.75,.14,.45),steel,bogie,bevel=.035)
            cylinder('BaggageCart_1_Turntable',(bx,.38,z+1.05),(bx,.51,z+1.05),.23,steel,bogie,32)
        box('Cart_%d_underframe'%i,(bx,.53,z),(1.72,.2,3.15),dark,cart,bevel=.045)
        box('Cart_%d_deck'%i,(bx,.72,z),(1.87,.12,3.2),steel,cart,bevel=.035)
        # Four upright rails, low toe boards, protective side bars and visible load cases.
        for x in (bx-.91,bx+.91):
            box('Cart_%d_side_toe_%s'%(i,x),(x,.92,z),(.08,.3,3.2),steel,cart)
            for zz in (z-1.52,z+1.52):box('Cart_%d_corner_%s_%s'%(i,x,zz),(x,1.3,zz),(.07,1.1,.07),steel,cart)
            for yy in (1.25,1.8):box('Cart_%d_rail_%s_%s'%(i,x,yy),(x,yy,z),(.055,.055,3.2),steel,cart)
            for zz in (z-1.05,z+1.05):
                if i==0:
                    axle='Front' if zz>z else 'Rear';side='PosX' if x>bx else 'NegX'
                    label='BaggageCart_1_'+axle+'_'+side
                    roll=wheel(bogie if axle=='Front' else cart,label,x,.31,zz,.31,.18)
                    roll.name=label+'_Roll'
                else:
                    wheel(cart,'Cart_%d_wheel_%s_%s'%(i,x,zz),x,.31,zz,.31,.18)
        for zz in (z-1.52,z+1.52):
            box('Cart_%d_end_toe_%s'%(i,zz),(bx,.92,zz),(1.8,.3,.06),steel,cart)
            box('Cart_%d_end_rail_%s'%(i,zz),(bx,1.8,zz),(1.8,.055,.055),steel,cart)
        for j in range(3):
            zz=z-.98+j*.97
            box('Cart_%d_baggage_case_%d'%(i,j),(bx,1.23,zz),(1.49,.85,.84),blue if (i+j)%2 else white,cart,bevel=.07)
            for x in (bx-.52,bx+.52):box('Cart_%d_case_strap_%d_%s'%(i,j,x),(x,1.66,zz),(.045,.015,.8),dark,cart)
        if i==0:
            drawbar=empty('BaggageCart_1_Drawbar',bogie)
            drawbar['pivot_browser']=[bx,0,z+1.05]
            cylinder('BaggageCart_1_Drawbar_shaft',(bx,.4,z+1.05),(bx,.4,z+2.57),.055,steel,drawbar,12)
        else:
            cylinder('Cart_%d_drawbar'%i,(bx,.4,z+1.65),(bx,.4,z+2.52),.055,steel,cart,12)
        cylinder('Cart_%d_rear_hitch'%i,(bx,.4,z-1.65),(bx,.4,z-1.82),.07,steel,cart,12)

    # Cones and wheel chocks at the waiting bay, none masquerade as active work.
    orange=material('Cone_orange',(.84,.22,.045,1),roughness=.68)
    def cone(name,x,z):
        group=empty(name,vehicles)
        box(name+'_rubber_base',(x,.025,z),(.4,.05,.4),rubber,group,bevel=.025)
        levels=[(.05,.16),(.26,.095),(.33,.075),(.56,.027)]
        for k in range(len(levels)-1):
            y0,r0=levels[k];y1,r1=levels[k+1]
            verts=[(x+math.cos(a*math.pi/12)*r,y,z+math.sin(a*math.pi/12)*r)
                   for y,r in ((y0,r0),(y1,r1)) for a in range(24)]
            mesh(name+'_shell_%d'%k,verts,[(a,(a+1)%24,(a+1)%24+24,a+24) for a in range(24)],white if k==1 else orange,group,smooth=True)
    for i,(x,z) in enumerate(((23.4,7.8),(18.4,7.8),(-37,20.7),(-31.5,20.7),(20,10),(20,-18))):cone('Safety_cone_%d'%i,x,z)
    for i,(x,z) in enumerate(((18.65,3.3),(18.65,3.8),(-35.5,16.5),(-35.5,17))):
        mesh('Parked_wheel_chock_%d'%i,[(x-.16,0,z-.16),(x+.16,0,z-.16),(x+.16,0,z+.16),(x-.16,0,z+.16),
             (x-.16,.16,z+.08),(x+.16,.16,z+.08)],[(0,1,2,3),(0,4,5,1),(1,5,2),(2,5,4,3),(3,4,0)],yellow,vehicles)
    # Each of the aircraft's six tyres gets a fore/aft pair. The wedge peaks
    # sit ~2-3 cm clear of the circular tread at their respective heights.
    chock_specs=[('Nose_NegX',-.235,13.05,.39,.12,.26,.30),('Nose_PosX',.235,13.05,.39,.12,.26,.30)]
    chock_specs += [(name,x,-2.2,.58,.16,.42,.43) for name,x in
                   [('Port_inner',3.13),('Port_outer',3.71),('Starboard_outer',-3.71),('Starboard_inner',-3.13)]]
    for name,x,zc,radius,height,width,offset in chock_specs:
        group=empty('Aircraft_'+name+'_Chocks',vehicles)
        group['wheelCenter_m']=[x,radius,zc];group['wheelRadius_m']=radius
        for direction,label in ((-1,'Aft'),(1,'Fore')):
            z=zc+direction*offset;half_depth=.08 if radius<.4 else .10
            mesh('Aircraft_'+name+'_Chock_'+label,[(x-width/2,0,z-half_depth),(x+width/2,0,z-half_depth),
                 (x+width/2,0,z+half_depth),(x-width/2,0,z+half_depth),(x-width/2,height,z),(x+width/2,height,z)],
                 [(0,1,2,3),(0,4,5,1),(1,5,2),(2,5,4,3),(3,4,0)],yellow,group)

    # Rebase from one immutable world-transform snapshot. All rotation empties
    # retain identity rotation; glTF therefore gives Roll a true local +X axis.
    bpy.context.view_layer.update()
    original_world={obj:obj.matrix_world.copy() for obj in vehicles.children_recursive}
    def rebase(parent):
        for obj in parent.children:
            target=original_world[obj].copy()
            if 'pivot_browser' in obj:target.translation=coord(obj['pivot_browser'])
            obj.matrix_world=target
            bpy.context.view_layer.update()
            rebase(obj)
    rebase(vehicles)
    bpy.context.view_layer.update()
    max_rebase_error=0.0
    for obj,before in original_world.items():
        if obj.type in {'MESH','CURVE'}:
            error=max(abs(obj.matrix_world[r][c]-before[r][c]) for r in range(4) for c in range(4))
            max_rebase_error=max(max_rebase_error,error)
            if error>1e-4:raise RuntimeError('Vehicle pivot rebase moved geometry: '+obj.name)
    # Exact connection anchors are separate reference nodes, not wheel hinges.
    rear_hitch=empty('BaggageTractor_RearHitch_anchor',baggage,position=(0,.4,-.62))
    front_hitch=empty('BaggageCart_1_FrontHitch_anchor',bpy.data.objects['BaggageCart_1_FrontBogie'],position=(0,.4,1.52))
    cart_rear_hitch=empty('BaggageCart_1_RearHitch_anchor',carts[0],position=(0,.4,-.77))
    for anchor in (rear_hitch,front_hitch,cart_rear_hitch):anchor['nodeRole']='connection_reference'
    for actor,position in ((tug,(21,0,5)),(baggage,(-28,0,14)),(carts[0],(-28,0,9.76)),(carts[1],(-34,0,18))):
        before={o:o.matrix_world.copy() for o in actor.children_recursive if o.type in {'MESH','CURVE'}}
        delta=coord(position)-actor.matrix_world.translation
        actor.location=coord(position)
        bpy.context.view_layer.update()
        for obj,old in before.items():
            expected=Matrix.Translation(delta)@old
            error=max(abs(obj.matrix_world[r][c]-expected[r][c]) for r in range(4) for c in range(4))
            if error>1e-4:raise RuntimeError('Vehicle parking changed mesh shape: '+obj.name)
    vehicles=batch_static(vehicles)
    bpy.context.view_layer.update()
    hitch_error=(rear_hitch.matrix_world.translation-front_hitch.matrix_world.translation).length
    if hitch_error>=1e-4:raise RuntimeError('Baggage hitch mismatch: '+str(hitch_error))
    tyre_bottom_errors=[]
    for obj in vehicles.children_recursive:
        if obj.type=='MESH' and obj.name.endswith('_tyre'):
            bottom=min((obj.matrix_world@v.co).z for v in obj.data.vertices)
            tyre_bottom_errors.append(abs(bottom))
            if abs(bottom)>=1e-4:raise RuntimeError('Floating/penetrating vehicle tyre: '+obj.name)
    chock_verification=_verify_aircraft_chocks(chock_specs)
    interface=_vehicle_interface(baggage,carts[0],carts[1],max_rebase_error,hitch_error,max(tyre_bottom_errors),chock_specs,chock_verification)
    (Path(__file__).resolve().parent/'vehicle-interface.json').write_text(json.dumps(interface,ensure_ascii=False,indent=2),encoding='utf8')
    return vehicles


def _verify_aircraft_chocks(chocks):
    """Measure the six actual aircraft tyre meshes when built in this scene."""
    names={'Nose_NegX':'Nose_wheel_-1','Nose_PosX':'Nose_wheel_1',
           'Port_inner':'Port_main_wheel_1','Port_outer':'Port_main_wheel_2',
           'Starboard_outer':'Starboard_main_wheel_1','Starboard_inner':'Starboard_main_wheel_2'}
    records=[]
    for name,x,z,radius,height,width,offset in chocks:
        tyre=bpy.data.objects.get(names[name]+'_rubber_tire')
        if tyre is None:return {'executed':False,'reason':'Build aircraft before vehicles to measure actual aircraft tyre geometry'}
        vertices=[tyre.matrix_world@v.co for v in tyre.data.vertices]
        tree=BVHTree.FromPolygons(vertices,[list(p.vertices) for p in tyre.data.polygons])
        wheel_ground_error=abs(min(p.z for p in vertices))
        group=bpy.data.objects['Aircraft_'+name+'_Chocks']
        samples=[];chock_vertices=[]
        for obj in group.children_recursive:
            if obj.type!='MESH':continue
            points=[obj.matrix_world@v.co for v in obj.data.vertices];chock_vertices+=points
            for poly in obj.data.polygons:
                face=[points[i] for i in poly.vertices]
                samples.append(sum(face,Vector())/len(face))
                samples.extend((face[i]+face[(i+1)%len(face)])/2 for i in range(len(face)))
        chock_ground_error=abs(min(p.z for p in chock_vertices))
        gaps=[tree.find_nearest(p)[3] for p in samples]
        nearest=min(gaps)
        if max(wheel_ground_error,chock_ground_error)>=1e-4 or not .005<nearest<.06:
            raise RuntimeError('Aircraft chock contact check failed: '+name+' '+str(nearest))
        records.append({'wheel':names[name],'chockGroup':group.name,'minimumSampledTreadGap_m':nearest,
                        'aircraftTyreGroundError_m':wheel_ground_error,'chockGroundError_m':chock_ground_error})
    return {'executed':True,'method':'actual world tyre mesh BVH; chock face centres and edge midpoints; Blender source geometry','wheels':records}


def _vehicle_interface(tractor,cart,parked_cart,rebase_error,hitch_error,contact_error,chocks,chock_verification):
    """Measured rig contract written with each Blender asset generation."""
    def browser(v):return [round(v.x,8),round(v.z,8),round(-v.y,8)]
    def pose(obj):return {'position_m':browser(obj.matrix_world.translation),'heading_rad':0,'scale':[1,1,1]}
    def bounds(obj):
        points=[o.matrix_world@v.co for o in obj.children_recursive if o.type=='MESH' for v in o.data.vertices]
        a=np.array([browser(p) for p in points]);return {'min_m':a.min(axis=0).tolist(),'max_m':a.max(axis=0).tolist(),'size_m':(a.max(axis=0)-a.min(axis=0)).tolist()}
    def motion(prefix):
        return {axle+'_'+side:prefix+'_'+axle+'_'+side+'_Roll' for axle in ('Front','Rear') for side in ('PosX','NegX')}
    nodes={}
    for actor in (tractor,cart):
        for obj in [actor]+list(actor.children_recursive):
            if obj.type!='EMPTY':continue
            matrix=obj.matrix_local
            q=matrix.to_quaternion()
            if max(abs(q.x),abs(q.y),abs(q.z),abs(q.w-1))>1e-6:
                raise RuntimeError('Vehicle motion empty has a non-identity basis: '+obj.name)
            nodes[obj.name]={'parent':obj.parent.name if obj.parent else None,'localPosition_m':browser(matrix.translation),
                             'localRotationQuaternion_xyzw':[0,0,0,1],'scale':[1,1,1]}
    return {
        'version':'0.2.0','units':'metres','axes':{'forward':'+Z','up':'+Y','wheelRoll':'+X','steering':'+Y'},
        'source':'environment.py; measured by build_vehicles; export is performed separately by generate.py',
        'nodes':nodes,
        'tractor':{'root':tractor.name,'rootReference':'rear axle ground point','initialWorldPose':pose(tractor),
            'wheelRadius_m':.37,'wheelWidth_m':.22,'wheelbase_m':1.83,'track_m':1.34,
            'rearAxleLocal_m':[0,.37,0],'frontAxleLocal_m':[0,.37,1.83],
            'steeringNodes':['BaggageTractor_Front_PosX_Steer','BaggageTractor_Front_NegX_Steer'],
            'rollNodes':motion('BaggageTractor'),'rearHitch':{'node':'BaggageTractor_RearHitch_anchor','parent':tractor.name,'local_m':[0,.4,-.62]},
            'boundsWorld':bounds(tractor)},
        'cart':{'root':cart.name,'rootReference':'rear axle ground point','initialWorldPose':pose(cart),
            'wheelRadius_m':.31,'wheelWidth_m':.18,'wheelbase_m':2.1,'track_m':1.82,
            'bodyWidth_m':1.9,'bodyLength_m':3.2,'bodyHeightRange_m':[.43,1.85],
            'frontBogie':{'node':'BaggageCart_1_FrontBogie','local_m':[0,0,2.1],'rotationAxis':'+Y'},
            'drawbar':{'node':'BaggageCart_1_Drawbar','parent':'BaggageCart_1_FrontBogie','length_m':1.52},
            'rollNodes':motion('BaggageCart_1'),
            'frontHitch':{'node':'BaggageCart_1_FrontHitch_anchor','parent':'BaggageCart_1_FrontBogie','local_m':[0,.4,1.52],'rootLocalNeutral_m':[0,.4,3.62]},
            'rearHitch':{'node':'BaggageCart_1_RearHitch_anchor','parent':cart.name,'local_m':[0,.4,-.77]},
            'boundsWorld':bounds(cart)},
        'parkedCart':{'root':parked_cart.name,'initialWorldPose':pose(parked_cart),'animate':False,'boundsWorld':bounds(parked_cart)},
        'aircraftReferences':{'L1':{'node':'Aircraft_L1_anchor','position_m':[1.980802,4.325,13.5]},'forwardCargo':{'node':'Aircraft_forward_cargo_anchor','position_m':[-1.675218,3.06,8.6]}},
        'aircraftChocks':[{'group':'Aircraft_'+name+'_Chocks','wheelCenter_m':[x,radius,z],'wheelRadius_m':radius,'count':2,'height_m':height,'peakOffsetZ_m':offset} for name,x,z,radius,height,width,offset in chocks],
        'verification':{'meshTransformPreservationMaxError':rebase_error,'initialHitchWorldError_m':hitch_error,'vehicleTyreGroundMaxError_m':contact_error,
                        'aircraftChocks':chock_verification,'executedIn':'Blender '+bpy.app.version_string,'exported':False}}
