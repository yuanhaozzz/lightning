"""AEROTWIN v0.1 helpers. Inputs use metres and browser axes X/Y-up/Z.

Only objects created by these helpers enter the current AEROTWIN collection.
No scene-wide deletion is permitted. Blender coordinates are (X, -Z, Y).
"""
import bpy
from mathutils import Vector

ACTIVE_COLLECTION = None

def coord(p):
    return Vector((p[0], -p[2], p[1]))

def begin_asset(name):
    global ACTIVE_COLLECTION
    collection_name = 'AEROTWIN_' + name + '_v01'
    old = bpy.data.collections.get(collection_name)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(old)
    ACTIVE_COLLECTION = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(ACTIVE_COLLECTION)
    return ACTIVE_COLLECTION

def attach(obj, parent=None):
    # Operators defer matrix recomputation: update before reparenting so a
    # freshly rotated cylinder keeps its axis instead of reverting to Z-up.
    bpy.context.view_layer.update()
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    ACTIVE_COLLECTION.objects.link(obj)
    if parent:
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
        obj.matrix_world = world
    return obj

def material(name, color, metallic=0, roughness=.5):
    mat = bpy.data.materials.get('AT_' + name) or bpy.data.materials.new('AT_' + name)
    mat.use_nodes = True
    rgba = tuple(color) if not isinstance(color, str) else tuple(int(color.lstrip('#')[i:i+2],16)/255 for i in (0,2,4))
    if len(rgba) == 3: rgba = (*rgba,1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = rgba
    return mat

def empty(name, parent=None, position=(0,0,0)):
    obj = bpy.data.objects.new(name, None)
    obj.location = coord(position)
    ACTIVE_COLLECTION.objects.link(obj)
    if parent: obj.parent = parent
    return obj

def mesh(name, verts, faces, mat, parent=None, smooth=False):
    data = bpy.data.meshes.new(name + '_geometry')
    data.from_pydata([coord(v) for v in verts], [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    ACTIVE_COLLECTION.objects.link(obj)
    if parent: obj.parent = parent
    for p in data.polygons: p.use_smooth = smooth
    return obj

def box(name, position, size, mat, parent=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=coord(position))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new('Machined_edge_radius', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        modifier = obj.modifiers.new('Weighted_surface_normals', 'WEIGHTED_NORMAL')
    return attach(obj,parent)

def uv_sphere(name, position, scale, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=coord(position))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0],scale[2],scale[1])
    obj.data.materials.append(mat)
    for p in obj.data.polygons: p.use_smooth = True
    return attach(obj,parent)

def cylinder(name, a, b, radius, mat, parent=None, vertices=24):
    start,end = coord(a),coord(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(end-start).length, location=(start+end)/2)
    obj=bpy.context.object
    obj.name=name
    obj.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
    obj.data.materials.append(mat)
    for p in obj.data.polygons: p.use_smooth = len(p.vertices)==4
    return attach(obj,parent)

def curve(name, points, radius, mat, parent=None):
    data=bpy.data.curves.new(name+'_geometry','CURVE')
    data.dimensions='3D'
    data.resolution_u=1
    data.bevel_depth=radius
    data.bevel_resolution=2
    spline=data.splines.new('POLY')
    spline.points.add(len(points)-1)
    for p,v in zip(spline.points,points): p.co=(*coord(v),1)
    data.materials.append(mat)
    obj=bpy.data.objects.new(name,data)
    ACTIVE_COLLECTION.objects.link(obj)
    if parent: obj.parent=parent
    return obj

def export_asset(collection, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.objects: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_extras=True, export_cameras=False,
        export_lights=False, export_animations=False)

