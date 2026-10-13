"""Headframe-only details. Shared primitive defaults remain unchanged."""
import math
import bpy
import bmesh
from mathutils import Vector

PARTS = [
    ('frame', '主承重框架', (0, 0, 6)),
    ('sheave', '提升天轮', (0, 0, 13.4)),
    ('bearings', '天轮轴承及支撑', (0, 0, 13.1)),
    ('platform', '顶部检修平台', (0, 0, 12.12)),
    ('stairs', '检修楼梯', (4.35, -.5, 6.2)),
    ('foundation', '基础与井口', (0, 0, 0)),
]

class HeadframeQuality:
    def __init__(self, primitives, config):
        self.p = primitives
        self.cfg = config
        self.scale = config['placement']['scale']
        self.posts = set()

    def bevel(self, obj, amount, segments=None):
        bm = bmesh.new(); bm.from_mesh(obj.data)
        edges=list(bm.edges)
        # Long tread/toe edges carry the visible highlight; do not tessellate
        # every tiny end corner on hundreds of repeated strips.
        if 'Tread_nosing' in obj.name or '_toe' in obj.name:
            longest=max(edge.calc_length() for edge in edges)
            edges=[edge for edge in edges if edge.calc_length()>longest*.9]
        bmesh.ops.bevel(bm, geom=edges, offset=amount,
                        segments=segments or self.cfg['details']['bevelSegments'], affect='EDGES')
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
        self.weighted_normals(obj)
        return obj

    @staticmethod
    def weighted_normals(obj):
        mesh = obj.data
        neighbours = [[] for _ in mesh.vertices]
        for poly in mesh.polygons:
            for vertex in poly.vertices: neighbours[vertex].append(poly)
        normals = [None] * len(mesh.loops)
        for poly in mesh.polygons:
            poly.use_smooth = True
            for loop in poly.loop_indices:
                normal = Vector((0, 0, 0))
                for other in neighbours[mesh.loops[loop].vertex_index]:
                    if poly.normal.dot(other.normal) > .35:
                        normal += other.normal * max(other.area, .000001)
                normals[loop] = tuple(normal.normalized())
        mesh.normals_split_custom_set(normals)

    def box(self, name, center, dimensions, mat, bevel=0):
        obj = self.p.box(name, center, dimensions, mat)
        if bevel and '_foot_' not in name and 'Tread_support' not in name:
            self.bevel(obj, min(bevel, min(dimensions) * .22))
        return obj

    def beam(self, name, start, end, width, depth, mat):
        a, b = Vector(start), Vector(end)
        obj = self.box(name, (a+b)/2, (width, depth, (b-a).length), mat,
                       .004 if 'nosing' in name or 'toe' in name else .006)
        obj.rotation_euler = self.p.section_rotation(b-a).to_euler()
        return obj

    def rod(self, name, start, end, radius, mat, vertices=16):
        return self.p.rod(name, start, end, radius, mat, vertices)

    def rail(self, name, start, end, mat, toe_mat, height=None):
        a, b = Vector(start), Vector(end)
        height = height if height is not None else self.cfg['access']['guardrailHeightWorld']/self.scale
        radius = self.cfg['access']['railDiameterWorld']/self.scale/2
        for h in (height, height/2):
            self.rod(f'{name}_rail_{h}', a+Vector((0,0,h)), b+Vector((0,0,h)), radius, mat)
        count = max(1, math.ceil((b-a).length/(self.cfg['access']['postSpacingWorld']/self.scale)))
        for i in range(count+1):
            foot=a.lerp(b,i/count); key=tuple(round(v,5) for v in foot)+(height,)
            if key in self.posts: continue
            self.posts.add(key)
            self.rod(f'{name}_post_{i}',foot,foot+Vector((0,0,height)),radius,mat)
            self.box(f'{name}_foot_{i}',foot+Vector((0,0,.009)),(.085,.085,.018),toe_mat,.002)
        self.beam(f'{name}_toe',a+Vector((0,0,.047)),b+Vector((0,0,.047)),.012,.094,toe_mat)

    def grate(self, name, xmin, xmax, ymin, ymax, top, mat, spacing=None, holes=()):
        if name.startswith('Tread_'):
            # Tread bearing bars span BETWEEN the two stair stringers. The
            # previous longitudinal bars needed many pieces but poor support.
            pitch=self.cfg['access']['gratingPitchWorld']/self.scale
            count=max(2,math.ceil((ymax-ymin)/pitch))
            for i in range(count+1):
                y=ymin+(ymax-ymin)*i/count
                self.p.box(f'{name}_bearing_{i}',((xmin+xmax)/2,y,top-.0125),(xmax-xmin,.006,.025),mat)
            for t in (.25,.75):
                x=xmin+(xmax-xmin)*t
                self.p.box(f'{name}_tie_{t}',(x,(ymin+ymax)/2,top-.005),(.006,ymax-ymin,.01),mat)
            return
        self.p.grate(name,xmin,xmax,ymin,ymax,top,mat,
                     spacing=spacing or self.cfg['access']['gratingPitchWorld']/self.scale,holes=holes)

    def grooved_wheel(self, mat):
        profile=[(-.21,1.02),(-.21,1.16),(-.165,1.16),(-.085,1.065),
                 (0,1.04),(.085,1.065),(.165,1.16),(.21,1.16),(.21,1.02)]
        segments=self.cfg['details']['sheaveSegments']; n=len(profile)
        verts=[(r*math.cos(i*math.tau/segments),y,13.4+r*math.sin(i*math.tau/segments)) for i in range(segments) for y,r in profile]
        faces=[tuple(reversed((i*n+j,((i+1)%segments)*n+j,((i+1)%segments)*n+(j+1)%n,i*n+(j+1)%n))) for i in range(segments) for j in range(n)]
        mesh=bpy.data.meshes.new('Main_sheave_groove');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Hoist_wheel_rim',mesh);bpy.context.collection.objects.link(obj)
        self.p.finish(obj,obj.name,mat)
        for poly in mesh.polygons:poly.use_smooth=True

    def spoke(self, name, center, angle, mat):
        radial=Vector((math.cos(angle),0,math.sin(angle))); tangent=Vector((-math.sin(angle),0,math.cos(angle)))
        vertices=[]
        for r,width,depth in ((.23,.19,.18),(1.065,.11,.14)):
            for u,v in ((-1,-1),(1,-1),(1,1),(-1,1)):
                vertices.append(tuple(center+radial*r+tangent*(u*width/2)+Vector((0,v*depth/2,0))))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);mesh.update()
        obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);self.p.finish(obj,name,mat)
        self.bevel(obj,self.cfg['details']['spokeBevel'],3)

    def bearing_housing(self, y, mat, machined):
        self.box(f'Bearing_housing_lower_{y}',(0,y,13.33),(.48,.38,.15),mat,.012)
        profile=[(-.18,0)]+[(.18*math.cos(math.pi-i*math.pi/24),.18*math.sin(math.pi-i*math.pi/24)) for i in range(25)]+[(.18,0)]
        verts=[(x,y+side*.19,13.39+z) for side in (-1,1) for x,z in profile]
        n=len(profile);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh=bpy.data.meshes.new('Pillow_block_cap');mesh.from_pydata(verts,[],faces)
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
        obj=bpy.data.objects.new(f'Bearing_housing_cap_{y}',mesh);bpy.context.collection.objects.link(obj);self.p.finish(obj,obj.name,mat)
        for poly in mesh.polygons:poly.use_smooth=len(poly.vertices)==4
        for x in (-.205,.205):
            self.box(f'Bearing_cap_lug_{y}_{x}',(x,y,13.395),(.075,.30,.035),mat,.005)
            for yy in (-.09,.09):self.rod(f'Bearing_cap_bolt_{y}_{x}_{yy}',(x,y+yy,13.405),(x,y+yy,13.445),.018,machined,6)
        self.rod(f'Bearing_grease_nipple_{y}',(0,y,13.57),(0,y,13.605),.012,machined)

    @staticmethod
    def part(name):
        if name.startswith(('Foundation_','Concrete_','Baseplate_','Anchor_','Stair_foundation','Stair_baseplate','Shaft_')):return 'foundation'
        if name.startswith(('Hoist_','Hub_','Axle_','Rope_contact')):return 'sheave'
        if name.startswith(('Bearing_','Wheel_support','Top_bearing_beam')):return 'bearings'
        if name.startswith(('Stair_','Tread_','Landing_','Top_stair_landing')):return 'stairs'
        if name.startswith(('Top_grate','Deck_','Top_west','Top_east','Top_north','Top_south','Opening_','Access_bridge','Bridge_guard')):return 'platform'
        return 'frame'

    def batch(self, objects, materials):
        buckets={}
        for obj in objects:
            part=self.part(obj.name)
            if obj.name.startswith(('Column_','Crossbeam_','Brace_','Stair_stringer','Deck_')):
                self.weighted_normals(obj)
            if obj.name=='Rope_contact_band':
                for poly in obj.data.polygons:poly.use_smooth=True
            buckets.setdefault((part,obj.data.materials[0].name),[]).append(obj)
        merged=[]
        for (part,mat),members in buckets.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in members:obj.select_set(True)
            bpy.context.view_layer.objects.active=members[0]
            if len(members)>1:bpy.ops.object.join()
            obj=bpy.context.object;obj.name=part+'__'+mat.replace(' ','_')
            bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
            merged.append((part,obj))
        root=bpy.data.objects.new('Headframe_assembly',None);bpy.context.collection.objects.link(root)
        root['assemblyId']=self.cfg['assemblyId'];root['schemaVersion']=2
        root['sourceOffset']=self.cfg['placement']['sourceOffset'];root['assemblyScale']=self.scale
        bpy.context.view_layer.update()
        nodes=[]
        for part,name,pivot in PARTS:
            group=bpy.data.objects.new(f'Headframe_{part}',None);bpy.context.collection.objects.link(group)
            group.parent=root;group.location=pivot
            group['kind']='headframe-part';group['entityId']=f'headframe-01/{part}'
            group['entityName']=name;group['parentEntityId']='headframe-01';group['partType']=part
            bpy.context.view_layer.update()
            for key,obj in merged:
                if key!=part:continue
                world=obj.matrix_world.copy();obj.parent=group
                obj.matrix_basis=group.matrix_world.inverted() @ world
            nodes.append({'id':group['entityId'],'name':name,'node':group.name,'pivotSourceZUp':list(pivot)})
        bpy.context.view_layer.update()
        return merged,nodes
