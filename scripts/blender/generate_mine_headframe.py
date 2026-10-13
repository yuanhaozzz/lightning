"""Generate one steel headframe and export a self-contained GLB, without UI.

blender.exe --background --factory-startup --python-exit-code 1 \
    --python scripts/blender/generate_mine_headframe.py
Optional output override: append -- --output path/to/mine-headframe.glb
Dimensions are meters; Blender Z-up is converted to glTF Y-up on export.
"""

import argparse
import math
import json
from pathlib import Path
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

RAIL_POSTS = set()


def material(name, color, metallic, roughness=0.48, texture=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if texture:
        # glTF cannot export Blender procedural nodes. Create packed image maps
        # for base color, roughness and tangent-space normal instead.
        rng = np.random.default_rng(17 if texture == "concrete" else 41)
        noise = rng.random((128, 128)).astype(np.float32)
        broad = noise.copy()
        for _ in range(5):
            broad = (broad + np.roll(broad, 1, 0) + np.roll(broad, -1, 0)
                     + np.roll(broad, 1, 1) + np.roll(broad, -1, 1)) / 5
        height = noise * 0.4 + broad * 0.6
        contrast = 0.20 if texture == "concrete" else 0.055
        pixels = np.ones((128, 128, 4), dtype=np.float32)
        pixels[:, :, :3] = np.clip(np.array(color)[None, None, :] + (height[:, :, None] - 0.5) * contrast, 0, 1)

        def image_node(suffix, values, non_color=False):
            img = bpy.data.images.new(f"{name}_{suffix}", width=128, height=128)
            if non_color:
                img.colorspace_settings.name = "Non-Color"
            img.pixels.foreach_set(values.ravel())
            img.pack()
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            return node

        color_node = image_node("albedo", pixels)
        mat.node_tree.links.new(color_node.outputs["Color"], shader.inputs["Base Color"])
        rough = np.ones_like(pixels)
        rough[:, :, :3] = np.clip(roughness + (height[:, :, None] - 0.5) * 0.15, 0.05, 0.98)
        rough_node = image_node("roughness", rough, True)
        mat.node_tree.links.new(rough_node.outputs["Color"], shader.inputs["Roughness"])
        normals = np.ones_like(pixels)
        strength = 0.45 if texture == "concrete" else 0.08
        dx = (np.roll(height, 1, 1) - np.roll(height, -1, 1)) * strength
        dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * strength
        normal = np.stack((dx, dy, np.ones_like(dx)), axis=2)
        normal /= np.linalg.norm(normal, axis=2, keepdims=True)
        normals[:, :, :3] = normal * 0.5 + 0.5
        normal_node = image_node("normal", normals, True)
        normal_map = mat.node_tree.nodes.new("ShaderNodeNormalMap")
        mat.node_tree.links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
        mat.node_tree.links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    return mat


def finish(obj, name, mat):
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def section_rotation(direction):
    direction = direction.normalized()
    across = Vector((0, 0, 1)).cross(direction)
    if across.length < 0.001:
        across = Vector((1, 0, 0))
    across.normalize()
    vertical = direction.cross(across).normalized()
    return Matrix((across, vertical, direction)).transposed().to_quaternion()


def beam(name, start, end, width, depth, mat):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = box(name, (start + end) / 2, (width, depth, direction.length), mat)
    obj.rotation_euler = section_rotation(direction).to_euler()
    return obj


def box(name, center, dimensions, mat, bevel=0):
    # Direct mesh construction avoids thousands of bpy.ops dependency-graph
    # updates when generating physical grating bars and individual steps.
    unit = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
            (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]
    verts = [tuple(v[i] * dimensions[i] for i in range(3)) for v in unit]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    if bevel:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = center
    return finish(obj, name, mat)


def section(name, start, end, width, depth, thickness, mat, hollow=False):
    """Fabricated H-section or hollow box, with actual flanges/walls."""
    start, end = Vector(start), Vector(end)
    rotation = section_rotation(end - start)
    center, length = (start + end) / 2, (end - start).length
    parts = [((0, (depth - thickness) / 2, 0), (width, thickness, length)),
             ((0, -(depth - thickness) / 2, 0), (width, thickness, length))]
    if hollow:
        parts += [(((width - thickness) / 2, 0, 0), (thickness, depth - 2 * thickness, length)),
                  ((-(width - thickness) / 2, 0, 0), (thickness, depth - 2 * thickness, length))]
    else:
        parts += [((0, 0, 0), (thickness, depth - 2 * thickness, length))]
    for i, (offset, dims) in enumerate(parts):
        obj = box(f"{name}_{i}", center + rotation @ Vector(offset), dims, mat, min(thickness / 5, 0.003))
        obj.rotation_euler = rotation.to_euler()


def rod(name, start, end, radius, mat, vertices=12):
    start, end = Vector(start), Vector(end)
    depth = (end - start).length
    coords = [(radius * math.cos(i * math.tau / vertices), radius * math.sin(i * math.tau / vertices), z)
              for z in (-depth / 2, depth / 2) for i in range(vertices)]
    faces = [(i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices)]
    faces += [tuple(reversed(range(vertices))), tuple(range(vertices, vertices * 2))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(coords, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (start + end) / 2
    obj.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()
    finish(obj, name, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    return obj


def rail(name, start, end, mat, toe_mat, height=1.1):
    start, end = Vector(start), Vector(end)
    length = (end - start).length
    for h in (height, height * 0.5):
        rod(f"{name}_rail_{h}", start + Vector((0, 0, h)), end + Vector((0, 0, h)), 0.024, mat)
    for i in range(max(1, math.ceil(length / 1.15)) + 1):
        foot = start.lerp(end, i / max(1, math.ceil(length / 1.15)))
        key = tuple(round(v, 5) for v in foot) + (height,)
        if key not in RAIL_POSTS:
            rod(f"{name}_post_{i}", foot, foot + Vector((0, 0, height)), 0.027, mat)
            RAIL_POSTS.add(key)
    # Continuous toe plate prevents loose tools falling off working platforms.
    beam(f"{name}_toe", start + Vector((0, 0, 0.075)), end + Vector((0, 0, 0.075)), 0.018, 0.15, toe_mat)


def grate(name, xmin, xmax, ymin, ymax, top, mat, spacing=0.065, holes=()):
    """Real open grating, rather than an opaque plane or alpha texture."""
    def subtract(interval, cuts):
        spans = [interval]
        for ca, cb in cuts:
            spans = [(sa, sb) for a, b in spans for sa, sb in ((a, min(b, ca)), (max(a, cb), b)) if sb - sa > 0.008]
        return spans

    for i in range(math.floor((xmax - xmin) / spacing) + 1):
        x = xmin + i * spacing
        cuts = [(ya, yb) for xa, xb, ya, yb in holes if xa - 0.006 <= x <= xb + 0.006]
        for j, (a, b) in enumerate(subtract((ymin, ymax), cuts)):
            box(f"{name}_bearing_{i}_{j}", (x, (a + b) / 2, top - 0.02), (0.012, b - a, 0.04), mat)
    for i in range(math.floor((ymax - ymin) / 0.25) + 1):
        y = ymin + i * 0.25
        cuts = [(xa, xb) for xa, xb, ya, yb in holes if ya - 0.006 <= y <= yb + 0.006]
        for j, (a, b) in enumerate(subtract((xmin, xmax), cuts)):
            box(f"{name}_cross_{i}_{j}", ((a + b) / 2, y, top - 0.008), (b - a, 0.012, 0.016), mat)


def grooved_wheel(mat):
    # A single cast sheave with a U-shaped rope groove; no overlapping torus rings.
    profile = [(-0.21, 1.02), (-0.21, 1.16), (-0.165, 1.16), (-0.085, 1.065),
               (0, 1.04), (0.085, 1.065), (0.165, 1.16), (0.21, 1.16), (0.21, 1.02)]
    verts, faces = [], []
    for i in range(64):
        a = i * math.tau / 64
        for y, radius in profile:
            verts.append((radius * math.cos(a), y, 13.4 + radius * math.sin(a)))
    n = len(profile)
    for i in range(64):
        for j in range(n):
            faces.append((i * n + j, ((i + 1) % 64) * n + j,
                          ((i + 1) % 64) * n + (j + 1) % n, i * n + (j + 1) % n))
    mesh = bpy.data.meshes.new("Grooved_sheave_mesh")
    mesh.from_pydata(verts, [], [tuple(reversed(face)) for face in faces])
    mesh.update()
    obj = bpy.data.objects.new("Hoist_wheel_rim", mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, obj.name, mat)
    for poly in mesh.polygons:
        poly.use_smooth = True


def build(parameters=None):
    # Keep the shared primitive functions above unchanged for other generators.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from headframe_quality import HeadframeQuality
    config = parameters or json.loads(Path(__file__).with_name("headframe.parameters.json").read_text(encoding="utf-8"))
    quality = HeadframeQuality(sys.modules[__name__], config)
    box, beam, rod, rail, grate = quality.box, quality.beam, quality.rod, quality.rail, quality.grate
    grooved_wheel = quality.grooved_wheel
    scene_scale = config["placement"]["scale"]
    stair_steps = config["access"]["stepsPerFlight"]
    stair_half_width = config["access"]["stairClearWidthWorld"] / scene_scale / 2
    stair_rail_offset = stair_half_width + .0225
    rail_height = config["access"]["guardrailHeightWorld"] / scene_scale
    rail_radius = config["access"]["railDiameterWorld"] / scene_scale / 2
    RAIL_POSTS.clear()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = "METRIC"
    steel = material("Painted structural steel", (0.20, 0.285, 0.32), 0.05, 0.52, "steel")
    wheel_mat = material("Cast sheave steel", (0.19, 0.205, 0.22), 0.82, 0.34)
    machined = material("Machined shaft and fasteners", (0.50, 0.53, 0.56), 0.95, 0.25)
    galvanized = material("Galvanized grating", (0.47, 0.51, 0.54), 0.78, 0.56, "steel")
    safety = material("Safety ochre coating", (0.66, 0.43, 0.055), 0, 0.5)
    concrete = material("Foundation concrete", (0.51, 0.50, 0.47), 0, 0.88, "concrete")
    dark = material("Shaft inner lining", (0.055, 0.063, 0.068), 0, 0.94)
    bearing = material("Bearing housings", (0.12, 0.18, 0.19), 0.15, 0.4)
    rope_liner = material("Sheave groove liner", (0.105, 0.12, 0.125), 0.35, 0.72)
    # Keep the original four-column outline, footprint and beam elevations.
    levels = tuple(config["interfaces"]["frameLevels"])
    assert levels == (0.35, 3.2, 6.1, 9.0, 11.9), "Protected main-frame elevations changed"
    assert config["interfaces"]["sheaveCenter"] == [0, 13.4, 0]
    assert config["interfaces"]["grooveRadius"] == 1.04
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))

    def point(corner, z):
        half_span = 2.6 - (z - levels[0]) / (levels[-1] - levels[0]) * 0.9
        x, y = corners[corner]
        return (x * half_span, y * half_span, z)

    # Hollow box columns and H-section crossbeams, supported on concrete piers.
    for i in range(4):
        section(f"Column_{i + 1}", point(i, levels[0]), point(i, levels[-1]), 0.32, 0.32, 0.024, steel, True)
        foot = point(i, 0.35)
        box(f"Concrete_pier_{i + 1}", (foot[0], foot[1], -0.125), (1.2, 1.2, 0.85), concrete, 0.035)
        box(f"Baseplate_{i + 1}", (foot[0], foot[1], 0.325), (0.72, 0.72, 0.05), machined, 0.005)
        for dx in (-0.27, 0.27):
            for dy in (-0.27, 0.27):
                x, y = foot[0] + dx, foot[1] + dy
                rod(f"Anchor_{i}_{dx}_{dy}", (x, y, 0.31), (x, y, 0.42), 0.022, machined)
                rod(f"Anchor_nut_{i}_{dx}_{dy}", (x, y, 0.36), (x, y, 0.395), 0.039, machined, 6)
    for level, z in enumerate(levels):
        for side in range(4):
            start, end = Vector(point(side, z)), Vector(point((side + 1) % 4, z))
            axis = (end - start).normalized()
            section(f"Crossbeam_{level + 1}_{side + 1}", start + axis * 0.18, end - axis * 0.18,
                    0.20, 0.30 if level == 4 else 0.24, 0.018, steel)
            for corner in (side, (side + 1) % 4):
                cp = Vector(point(corner, z))
                # Fabricated end connection plate sits on the column surface.
                box(f"Beam_endplate_{level}_{side}_{corner}", cp + axis * (0.167 if corner == side else -0.167),
                    (0.035, 0.28, 0.28) if abs(axis.x) > 0.5 else (0.28, 0.035, 0.28), machined)
    # Alternating single diagonals avoid the former intersecting X members.
    # Two knee braces leave a clear opening in the ground-level front face.
    brace_segments = []
    for bay, (low, high) in enumerate(zip(levels, levels[1:])):
        for side in range(4):
            other = (side + 1) % 4
            outward = (Vector(point(side, low)) + Vector(point(other, low))) / 2
            outward.z = 0
            outward.normalize()
            offset = outward * 0.185
            if bay == 0 and side == 0:
                pairs = [(Vector(point(0, 2.1)), Vector((-1.0, point(0, high)[1], high - 0.15))),
                         (Vector(point(1, 2.1)), Vector((1.0, point(1, high)[1], high - 0.15)))]
            elif (bay + side) % 2:
                pairs = [(Vector(point(other, low + 0.16)), Vector(point(side, high - 0.16)))]
            else:
                pairs = [(Vector(point(side, low + 0.16)), Vector(point(other, high - 0.16)))]
            for j, (a, b) in enumerate(pairs):
                a, b = a + offset, b + offset
                section(f"Brace_{bay}_{side}_{j}", a, b, 0.12, 0.10, 0.01, steel, True)
                brace_segments.append((tuple(a), tuple(b), bay, side))
                for k, joint in enumerate((a, b)):
                    dims = (0.40, 0.018, 0.40) if side % 2 == 0 else (0.018, 0.40, 0.40)
                    box(f"Gusset_{bay}_{side}_{j}_{k}", joint, dims, steel, 0.005)
                    for dz in (-0.09, 0.09):
                        center = joint + Vector((0, 0, dz)) + outward * 0.06
                        rod(f"Gusset_bolt_{bay}_{side}_{j}_{k}_{dz}", center, center + outward * 0.027, 0.028, machined, 6)

    # Bearing beams transmit sheave loads to the original top frame.
    wheel_center = Vector((0, 0, 13.4))
    for y in (-0.82, 0.82):
        section(f"Top_bearing_beam_{y}", (-1.7, y, 11.9), (1.7, y, 11.9), 0.30, 0.36, 0.024, steel)
        section(f"Wheel_support_{y}", (0, y, 12.08), (0, y, 13.20), 0.25, 0.25, 0.024, steel)
        for x in (-0.70, 0.70):
            section(f"Bearing_knee_{y}_{x}", (x, y, 12.08), (0, y, 13.12), 0.09, 0.09, 0.01, steel, True)
        box(f"Bearing_base_{y}", (0, y, 13.20), (0.65, 0.55, 0.09), machined, 0.008)
        quality.bearing_housing(y, bearing, machined)
        for x in (-0.25, 0.25):
            rod(f"Bearing_mount_bolt_{y}_{x}", (x, y, 13.24), (x, y, 13.28), 0.032, machined, 6)
    rod("Hoist_axle", (0, -1.16, 13.4), (0, 1.16, 13.4), 0.095, machined, 32)
    grooved_wheel(wheel_mat)
    # Thin inner contact band makes the groove distinct from the cast rim.
    bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=8, major_radius=1.045,
                                    minor_radius=0.014, location=wheel_center, rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.object, "Rope_contact_band", rope_liner)
    rod("Hoist_wheel_hub", (0, -0.29, 13.4), (0, 0.29, 13.4), 0.245, wheel_mat, 32)
    for y in (-0.29, 0.29):
        rod(f"Hub_flange_{y}", (0, y - 0.022, 13.4), (0, y + 0.022, 13.4), 0.29, machined, 32)
        for i in range(6):
            a = i * math.tau / 6
            x, z = math.cos(a) * 0.19, 13.4 + math.sin(a) * 0.19
            rod(f"Hub_bolt_{y}_{i}", (x, y - 0.036, z), (x, y + 0.036, z), 0.023, machined, 6)
    for y in (-0.48, 0.48):
        rod(f"Axle_collar_{y}", (0, y - 0.045, 13.4), (0, y + 0.045, 13.4), 0.14, machined, 24)
    for i in range(8):
        angle = i * math.tau / 8
        direction = Vector((math.cos(angle), 0, math.sin(angle)))
        quality.spoke(f"Hoist_wheel_spoke_{i + 1}", wheel_center, angle, wheel_mat)

    # Main service deck, with a rectangular central opening around the sheave
    # and rope path. All grating bears on actual stringers or perimeter beams.
    deck = 12.12
    for label, rectangle in enumerate([(-2.4, 2.4, -2.8, -0.40), (-2.4, 2.4, 0.40, 2.4),
                                       (-2.4, -1.30, -0.40, 0.40), (1.30, 2.4, -0.40, 0.40)]):
        grate(f"Top_grate_{label}", *rectangle, deck, galvanized,
              holes=((-0.35, 0.35, -1.13, -0.51), (-0.35, 0.35, 0.51, 1.13)))
    for y in (-2.8, -1.65, -0.40, 0.40, 1.65, 2.4):
        section(f"Deck_stringer_{y}", (-2.4, y, 12.02), (2.4, y, 12.02), 0.12, 0.16, 0.012, steel)
    for x in (-2.4, -1.3, 1.3, 2.4):
        section(f"Deck_edge_{x}", (x, -2.8, 12.02), (x, 2.4, 12.02), 0.12, 0.16, 0.012, steel)
    for x in (-1.7, 1.7):
        for y in (-1.7, 1.7):
            section(f"Deck_bracket_{x}_{y}", (x, y, 11.0), (math.copysign(2.3, x), math.copysign(2.3, y), 11.94),
                    0.1, 0.1, 0.012, steel, True)
    rail("Top_west", (-2.4, -2.8, deck), (-2.4, 2.4, deck), safety, steel)
    rail("Top_north", (-2.4, 2.4, deck), (2.4, 2.4, deck), safety, steel)
    rail("Top_south", (-2.4, -2.8, deck), (2.4, -2.8, deck), safety, steel)
    rail("Top_east", (2.4, -1.85, deck), (2.4, 2.4, deck), safety, steel)
    # Low raised coaming outlines the central opening without crossing the axle.
    for y in (-0.40, 0.40):
        beam(f"Opening_coaming_{y}", (-1.3, y, deck + 0.065), (1.3, y, deck + 0.065), 0.012, 0.13, safety)

    # Independent exterior stair support frame: two accessible flights per bay,
    # 0.85 m clear treads, 0.30 m going, and approximately 0.16 m rise.
    stair_levels = (0.35, 3.2, 6.1, 9.0, deck)
    for x in (3.3, 5.4):
        for y in (-2.8, 1.8):
            box(f"Stair_foundation_{x}_{y}", (x, y, -0.15), (0.72, 0.72, 0.8), concrete, 0.025)
            box(f"Stair_baseplate_{x}_{y}", (x, y, 0.275), (0.42, 0.42, 0.05), machined)
            section(f"Stair_post_{x}_{y}", (x, y, 0.30), (x, y, deck), 0.14, 0.14, 0.012, steel, True)
    for bay, (low, high) in enumerate(zip(stair_levels, stair_levels[1:])):
        mid = (low + high) / 2
        for z, ya, yb in ((low, -2.8, -1.85), (mid, 0.85, 1.8)):
            grate(f"Stair_landing_{bay}_{z}", 3.3, 5.4, ya, yb, z, galvanized)
            for y in (ya, yb):
                section(f"Landing_beam_{bay}_{z}_{y}", (3.3, y, z - 0.11), (5.4, y, z - 0.11), 0.12, 0.18, 0.012, steel)
            for x in (3.3, 5.4):
                section(f"Landing_side_{bay}_{z}_{x}", (x, ya, z - 0.11), (x, yb, z - 0.11), 0.12, 0.18, 0.012, steel)
                rail(f"Landing_side_guard_{bay}_{z}_{x}", (x, ya, z), (x, yb, z), safety, steel)
            outside = ya if z == low else yb
            rail(f"Landing_guard_{bay}_{z}", (3.3, outside, z), (5.4, outside, z), safety, steel)
        for flight, (x, a, b, z0, z1) in enumerate(((3.82, -1.85, 0.85, low, mid), (4.90, 0.85, -1.85, mid, high))):
            rise = (z1 - z0) / stair_steps
            for step in range(stair_steps):
                ya, yb = a + (b - a) * step / stair_steps, a + (b - a) * (step + 1) / stair_steps
                z = z0 + (step + 1) * rise
                grate(f"Tread_{bay}_{flight}_{step}", x - stair_half_width, x + stair_half_width, min(ya, yb), max(ya, yb), z, galvanized)
                box(f"Tread_nosing_{bay}_{flight}_{step}", (x, ya, z - 0.015), (2 * stair_half_width, 0.022, 0.03), safety, .004)
                for sign in (-1, 1):
                    box(f"Tread_support_{bay}_{flight}_{step}_{sign}",
                        (x + sign * (stair_half_width + .012), (ya + yb) / 2, z - 0.045),
                        (0.075, abs(yb - ya) * .8, 0.04), steel, .003)
            for sign in (-1, 1):
                sx = x + sign * stair_rail_offset
                section(f"Stair_stringer_{bay}_{flight}_{sign}", (sx, a, z0 - 0.06), (sx, b, z1 - 0.06), 0.06, 0.16, 0.01, steel)
                # Upright posts above the step nosings and two continuous rails.
                for step in sorted(set(range(0, stair_steps + 1, 3)) | {stair_steps}):
                    y = a + (b - a) * step / stair_steps
                    z = z0 + (z1 - z0) * step / stair_steps
                    rod(f"Stair_guard_post_{bay}_{flight}_{sign}_{step}", (sx, y, z), (sx, y, z + rail_height), rail_radius, safety)
                    box(f"Stair_guard_foot_{bay}_{flight}_{sign}_{step}", (sx, y, z+.01), (.07,.07,.02), steel, .002)
                for h in (rail_height / 2, rail_height):
                    rod(f"Stair_handrail_{bay}_{flight}_{sign}_{h}", (sx, a, z0 + h), (sx, b, z1 + h), rail_radius, safety)
        # Bracing is confined to the outside face, clear of both stair flights.
        section(f"Stair_outer_brace_{bay}", (5.48, -2.8, low), (5.48, 1.8, high), 0.07, 0.07, 0.008, steel, True)
        for y in (-2.8, 1.8):
            section(f"Stair_level_tie_{bay}_{y}", (3.3, y, high - 0.10), (5.4, y, high - 0.10), 0.12, 0.18, 0.012, steel)
    grate("Top_stair_landing", 3.3, 5.4, -2.8, -1.85, deck, galvanized)
    grate("Access_bridge", 2.4, 3.3, -2.8, -1.85, deck, galvanized)
    for y in (-2.8, -1.85):
        section(f"Access_bridge_beam_{y}", (1.7, y, 12.0), (5.4, y, 12.0), 0.12, 0.18, 0.012, steel)
        rail(f"Bridge_guard_{y}", (2.4, y, deck), (3.3, y, deck), safety, steel)
    rail("Stair_top_south", (3.3, -2.8, deck), (5.4, -2.8, deck), safety, steel)
    rail("Stair_top_east", (5.4, -2.8, deck), (5.4, -1.85, deck), safety, steel)
    rail("Stair_top_closed_flight", (3.3, -1.85, deck), (4.37, -1.85, deck), safety, steel)

    # Square shaft collar aligned under the positive-X tangent of the sheave.
    # The foundation apron has a real opening, not a dark disk on a solid slab.
    opening = (0.22, 1.92, -0.85, 0.85)
    x0, x1, y0, y1 = opening
    for label, rectangle in enumerate([(-3.35, x0 - 0.2, -3.35, 3.35), (x1 + 0.2, 5.8, -3.35, 3.35),
                                       (x0 - 0.2, x1 + 0.2, -3.35, y0 - 0.2), (x0 - 0.2, x1 + 0.2, y1 + 0.2, 3.35)]):
        xa, xb, ya, yb = rectangle
        box(f"Foundation_apron_{label}", ((xa + xb) / 2, (ya + yb) / 2, -0.48), (xb - xa, yb - ya, 0.20), concrete, 0.012)
    for x in (x0 - 0.1, x1 + 0.1):
        box(f"Shaft_collar_x_{x}", (x, 0, -0.22), (0.2, 2.1, 1.9), concrete, 0.016)
    for y in (y0 - 0.1, y1 + 0.1):
        box(f"Shaft_collar_y_{y}", ((x0 + x1) / 2, y, -0.22), (1.7, 0.2, 1.9), concrete, 0.016)
    box("Shaft_depth", ((x0 + x1) / 2, 0, -1.18), (1.7, 1.7, 0.03), dark)
    for x in (x0 - 0.1, x1 + 0.1):
        rail(f"Shaft_guard_x_{x}", (x, -0.95, 0.73), (x, 0.95, 0.73), safety, steel)
    for y in (-0.95, 0.95):
        rail(f"Shaft_guard_y_{y}", (x0 - 0.1, y, 0.73), (x1 + 0.1, y, 0.73), safety, steel)

    objects = list(bpy.context.scene.objects)
    assert len([obj for obj in objects if obj.name.startswith("Column_")]) == 16  # four walls per column
    assert len(brace_segments) == 17  # 15 single diagonals + two portal knees
    assert 13.4 - 1.16 - deck > 0.10  # sheave/deck clearance
    assert 3.82 - stair_rail_offset - (2.6 + 0.32 / 2 + 0.185) > 0.35
    assert max(b-a for a,b in zip(stair_levels,stair_levels[1:])) * scene_scale / (2*stair_steps) < .18
    assert all(obj.type == "MESH" for obj in objects)
    bpy.context.view_layer.update()
    # Check moving sheave against stationary supports and working deck using
    # actual triangle geometry. Hub/spoke/rim joins and foundation/bolt contact
    # are intentional and are not blanket-reported as collisions.
    def tree(obj):
        vertices = [obj.matrix_world @ v.co for v in obj.data.vertices]
        return BVHTree.FromPolygons(vertices, [tuple(p.vertices) for p in obj.data.polygons])

    rim = next(obj for obj in objects if obj.name == "Hoist_wheel_rim")
    rim_tree = tree(rim)
    checked = [obj for obj in objects if obj.name.startswith(("Wheel_support", "Bearing_", "Top_grate", "Opening_coaming", "Top_bearing_beam"))]
    overlaps = [obj.name for obj in checked if rim_tree.overlap(tree(obj))]
    assert not overlaps, f"Sheave collision: {overlaps}"
    # Generate UVs for custom meshes; primitive mesh UVs survive all joins.
    for obj in objects:
        if not obj.data.uv_layers:
            uv = obj.data.uv_layers.new(name="UVMap")
            for poly in obj.data.polygons:
                axis = max(range(3), key=lambda i: abs(poly.normal[i]))
                axes = [i for i in range(3) if i != axis]
                for loop in poly.loop_indices:
                    v = obj.data.vertices[obj.data.loops[loop].vertex_index].co
                    uv.data[loop].uv = (v[axes[0]], v[axes[1]])
    stats = {"logicalColumns": 4, "frameLevels": list(levels), "singleBracesAndPortalKnees": len(brace_segments),
             "stairFlights": 8, "stairSteps": 8 * stair_steps, "stairClearWidthMeters": stair_half_width * 2,
             "maxRiserMeters": max(b - a for a, b in zip(stair_levels, stair_levels[1:])) / (2 * stair_steps),
             "treadGoingMeters": 2.70 / stair_steps, "guardrailHeightMeters": rail_height,
             "sheaveDeckClearanceMeters": round(13.4 - 1.16 - deck, 3),
             "sheaveStationaryCollisionChecks": len(checked), "sheaveCollisions": overlaps,
             "stairMainFrameClearanceMeters": round(3.82 - stair_rail_offset - (2.6 + 0.32 / 2 + 0.185), 3),
             "sourceObjects": len(objects)}
    merged, parts = quality.batch(objects, (steel, wheel_mat, machined, galvanized, safety, concrete, dark, bearing, rope_liner))
    exported = [obj for _,obj in merged]
    stats["schemaVersion"] = 2
    stats["semanticParts"] = parts
    stats["placement"] = config["placement"]
    stats["worldDimensions"] = {"guardrailHeight": rail_height * scene_scale,
        "stairClearWidth": stair_half_width * 2 * scene_scale,
        "maxRiser": stats["maxRiserMeters"] * scene_scale,
        "treadGoing": stats["treadGoingMeters"] * scene_scale}
    stats["exportMeshes"] = len(exported)
    stats["triangles"] = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons) for obj in exported)
    assert stats["exportMeshes"] <= config["budget"]["maxPrimitives"]
    assert stats["triangles"] < config["budget"]["maxTriangles"], json.dumps(stats)
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "public/models/mine-headframe.glb")
    parser.add_argument("--parameters", type=Path, default=Path(__file__).with_name("headframe.parameters.json"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    stats = build(json.loads(args.parameters.read_text(encoding="utf-8")))
    result = bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True,
                                       export_cameras=False, export_lights=False, export_animations=False,
                                       export_extras=True)
    assert result == {"FINISHED"}, result
    assert output.is_file() and output.stat().st_size > 0
    stats["glbBytes"] = output.stat().st_size
    output.with_suffix(".report.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(f"CODEX_HEADFRAME_EXPORT_OK {json.dumps(stats)} output={output}")


if __name__ == "__main__":
    main()
