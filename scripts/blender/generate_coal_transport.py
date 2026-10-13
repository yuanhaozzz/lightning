"""Phase 4: two silos, transfer station and three detailed belt conveyors.

blender.exe -b --factory-startup --python-exit-code 1 --python this_file
Optional -- --parameters custom.json --output-dir public/models
Meters, Three.js Y-up coordinates. Building origins remain footprint centers.
Conveyors use world coordinates and existing XZ routes. Reference elevations
describe the old massing envelope: working belt levels are explicitly offset
to provide gravity transfer and fit rollers, return belt and truss underneath.
Reference photographs are never read or used as textures.
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
box,beam,section,rod,mesh=p.box,p.beam,p.section,p.rod,p.mesh
PORTS=[]
SUPPORTS=[]
PATHS=[]
COLLIDERS=[]


def materials():
    palette={
        'concrete':((.46,.48,.46),0,.90,'concrete'),
        'wall':((.55,.59,.58),.24,.68,'steel'),
        'roof':((.22,.30,.33),.55,.47,'steel'),
        'steel':((.12,.19,.22),.68,.43,'steel'),
        'trim':((.38,.44,.46),.75,.38,None),
        'machined':((.34,.37,.40),.92,.30,None),
        'safety':((.81,.46,.085),.2,.48,None),
        'rubber':((.025,.032,.031),.0,.88,None),
        'glass':((.075,.17,.21),.2,.18,None),
    }
    for key,values in palette.items():p.M[key]=p.primitives.material('Transport_'+key,*values)


def rail(a,b,height=1.05):
    a,b=Vector(a),Vector(b)
    for h in (.53,height):rod('guardrail',a+Vector((0,h,0)),b+Vector((0,h,0)),.025,'safety',8)
    n=max(1,math.ceil((b-a).length/1.6))
    for i in range(n+1):
        c=a.lerp(b,i/n)
        rod('rail_post',c,c+Vector((0,height,0)),.029,'safety',8)
    beam('toe_board',a+Vector((0,.07,0)),b+Vector((0,.07,0)),.025,.12,'steel')


def arc(name,c,radius,y,tube,mat='trim',start=0,end=math.tau,steps=64):
    for i in range(steps):
        a=start+(end-start)*i/steps;b=start+(end-start)*(i+1)/steps
        rod(name,(c[0]+radius*math.cos(a),y,c[2]+radius*math.sin(a)),
            (c[0]+radius*math.cos(b),y,c[2]+radius*math.sin(b)),tube,mat,6)


def shell(name,c,y0,y1,r0,r1,thick,mat,sides=64):
    verts=[]
    for y,r in ((y0,r0),(y1,r1),(y0,r0-thick),(y1,r1-thick)):
        verts.extend((c[0]+r*math.cos(i*math.tau/sides),y,c[2]+r*math.sin(i*math.tau/sides)) for i in range(sides))
    faces=[]
    for i in range(sides):
        j=(i+1)%sides
        faces.extend([(i,j,sides+j,sides+i),(2*sides+j,2*sides+i,3*sides+i,3*sides+j),
                      (i,2*sides+i,2*sides+j,j),(sides+j,3*sides+j,3*sides+i,sides+i)])
    obj=mesh(name,verts,[tuple(reversed(face)) for face in faces],mat)
    for i,poly in enumerate(obj.data.polygons):poly.use_smooth=i%4<2
    return obj


def plate(name,verts,mat,thickness=.015):
    vs=[Vector(v) for v in verts]
    normal=(vs[1]-vs[0]).cross(vs[2]-vs[0]).normalized()*thickness
    # Closed thin sheet: duplicated reversed faces are invalid Blender meshes.
    return mesh(name,vs+[v-normal for v in vs],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],mat)


def ladder(x,z,height):
    for dz in (-.3,.3):rod('ladder_stile',(x,.18,z+dz),(x,height+.18,z+dz),.033,'trim',10)
    for i in range(math.ceil(height/.3)):
        y=.25+i*.3
        rod('ladder_rung',(x,y,z-.3),(x,y,z+.3),.025,'trim',8)
    # Half-cage faces away from silo; rails leave the body-facing side open.
    side=1 if x>0 else -1
    for y in [2.6+i*.85 for i in range(math.ceil((height-2.6)/.85))]:
        for i in range(12):
            a=-math.pi/2+math.pi*i/12;b=-math.pi/2+math.pi*(i+1)/12
            rod('ladder_cage',(x+side*.46*math.cos(a),y,z+.46*math.sin(a)),
                (x+side*.46*math.cos(b),y,z+.46*math.sin(b)),.017,'trim',6)
    for a in (-math.pi/2,-math.pi/4,0,math.pi/4,math.pi/2):
        xx=x+side*.46*math.cos(a);zz=z+.46*math.sin(a)
        rod('cage_stringer',(xx,2.6,zz),(xx,height,zz),.014,'trim',6)
    for y in [v for v in (.5,3,6,9,11.5) if v<height]:
        for dz in (-.3,.3):beam('ladder_wall_bracket',(x,y,z+dz),(side*4.15,y,z+dz),.07,.07,'trim')


def silo(cfg,approach):
    side=cfg['ladderSide'];n=64
    for x in (-3.25,3.25):
        for z in (-3.25,3.25):
            box('silo_foundation',(x,.24,z),(1.05,.44,1.05),'concrete',.02)
            box('column_base_plate',(x,.49,z),(.58,.055,.58),'machined')
            section('silo_support_column',(x,.5,z),(x,4.25,z),.32,.38)
            for dx in (-.22,.22):
                for dz in (-.22,.22):rod('anchor_bolt',(x+dx,.46,z+dz),(x+dx,.57,z+dz),.025,'machined',6)
    for axis in (0,2):
        for sign in (-1,1):
            def pt(t,y):return (t,y,sign*3.25) if axis==0 else (sign*3.25,y,t)
            section('silo_ring_support',pt(-3.4,4.2),pt(3.4,4.2),.25,.36)
            beam('silo_lower_tie',pt(-3.25,.8),pt(3.25,.8),.12,.14)
            for a,b in ((pt(-3.25,.8),pt(0,3.1)),(pt(3.25,.8),pt(0,3.1))):beam('silo_diagonal',a,b,.13,.16)
    shell('hopper',(0,0,0),2.05,4.25,.58,4.23,.07,'steel',n)
    shell('concrete_silo_wall',(0,0,0),4.25,9.62,4.25,4.25,.18,'concrete',n)
    for y in (4.3,6.1,7.9,9.60):arc('construction_joint',(0,0,0),4.256,y,.016,'trim',steps=n)
    # Annular roof leaves a real receiving hole rather than burying a chute.
    shell('silo_roof',(0,0,0),9.62,9.79,4.34,4.34,3.55,'concrete',n)
    shell('feed_socket',(0,0,0),9.75,10.14,.72,.72,.065,'steel',32)
    box('discharge_slide_gate',(0,1.99,0),(1.38,.2,1.2),'trim')
    shell('discharge_spout',(0,0,0),.88,1.9,.48,.57,.045,'steel',32)
    rod('gate_actuator',(.7,1.99,0),(1.2,1.99,0),.08,'machined',16)
    box('actuator_bracket',(1.15,1.8,0),(.26,.38,.3),'steel')
    # Grating annulus: open radial strips and rings, supported at roof edge.
    for i in range(96):
        a=i*math.tau/96
        beam('roof_grating_radial',(3.62*math.cos(a),9.83,3.62*math.sin(a)),(4.55*math.cos(a),9.83,4.55*math.sin(a)),.025,.045,'trim')
    for r in (3.65,3.85,4.05,4.25,4.48,4.55):arc('grating_band',(0,0,0),r,9.83,.018,'trim',steps=64)
    entry=math.atan2(-approach[2],-approach[0])
    for i in range(48):
        a=i*math.tau/48;b=(i+1)*math.tau/48
        diff=math.atan2(math.sin((a+b)/2-entry),math.cos((a+b)/2-entry))
        if abs(diff)<.40:continue  # actual incoming conveyor portal
        aa=(4.56*math.cos(a),9.84,4.56*math.sin(a));bb=(4.56*math.cos(b),9.84,4.56*math.sin(b))
        for h in (.55,1.04):rod('roof_guardrail',Vector(aa)+Vector((0,h,0)),Vector(bb)+Vector((0,h,0)),.022,'safety',8)
        if i%2==0:rod('roof_rail_post',aa,Vector(aa)+Vector((0,1.04,0)),.025,'safety',8)
    ladder(side*4.53,0,9.85)
    box('ladder_rest_platform',(side*4.43,6.35,0),(.94,.075,1.25),'trim')
    for z in (-.62,.62):rail((side*4.0,6.39,z),(side*4.88,6.39,z))
    # Feed boot sits over socket and encloses the head discharge flight.
    h=Vector((0,12.35,0));u=Vector(approach);q=h+u*.48
    chute('silo_receiving_boot',q+Vector((0,.28,0)),(0,9.87,0),.85,.9)
    right=Vector((0,1,0)).cross(u).normalized();up=u.cross(right).normalized()
    for sign in (-1,1):
        seat=h+right*sign*.61-up*.26
        section('head_support',(seat.x,9.79,seat.z),(seat.x,seat.y-.18,seat.z),.12,.16)
        box('head_bearing_seat',(seat.x,seat.y-.15,seat.z),(.40,.09,.40),'steel')
    # Raised head-service deck flanks the belt; its central opening keeps the
    # return flight and truss clear. Supports bear on the existing roof ring.
    for sign in (-1,1):
        a=right*sign*1.12;b=right*sign*1.9
        for t in (-.65,.65):
            for q0 in (a,b):
                q0=q0+u*t
                section('head_deck_post',(q0.x,9.79,q0.z),(q0.x,11.7,q0.z),.10,.13)
            beam('head_deck_crossbeam',a+u*t+Vector((0,11.7,0)),b+u*t+Vector((0,11.7,0)),.09,.12)
        for i in range(8):
            t=-.65+i*.18
            beam('head_service_grating',a+u*t+Vector((0,11.76,0)),b+u*t+Vector((0,11.76,0)),.025,.045,'trim')
        rail(b-u*.65+Vector((0,11.8,0)),b+u*.65+Vector((0,11.8,0)))
    foot=right*1.8
    for t in (-.27,.27):rod('roof_access_stile',foot+u*t+Vector((0,9.81,0)),foot+u*t+Vector((0,12.0,0)),.026,'trim',8)
    for i in range(8):rod('roof_access_rung',foot-u*.27+Vector((0,9.9+i*.26,0)),foot+u*.27+Vector((0,9.9+i*.26,0)),.023,'trim',8)
    PORTS.append({'id':cfg['id'],'headBelt':[cfg['position'][0],12.35,cfg['position'][2]],'socket':[cfg['position'][0],9.87,cfg['position'][2]],'railPortalAngle':entry})


def chute(name,a,b,w=.75,d=.8):
    a,b=Vector(a),Vector(b);u=(b-a).normalized()
    right=Vector((0,1,0)).cross(u).normalized();up=u.cross(right).normalized()
    corners=[right*s*w/2+up*t*d/2 for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
    # Open ends, closed sides with real wall thickness; no opaque end cap.
    for i in range(4):
        j=(i+1)%4
        aa=a+corners[i];bb=a+corners[j];cc=b+corners[j];dd=b+corners[i]
        normal=((bb-aa).cross(dd-aa)).normalized()*.025
        vs=[aa,bb,cc,dd,aa+normal,bb+normal,cc+normal,dd+normal]
        faces=[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
        mesh(name+'_wall',vs,[tuple(reversed(face)) for face in faces],'roof')
    for c in (a,b):
        for i in range(4):rod(name+'_flange',c+corners[i],c+corners[(i+1)%4],.032,'trim',8)


def panel_wall(name,axis,fixed,low,high,y0,y1,holes):
    xs=sorted(set([low,high]+[v for h in holes for v in h[:2]]));ys=sorted(set([y0,y1]+[v for h in holes for v in h[2:]]))
    for a,b in zip(xs,xs[1:]):
        for c,d in zip(ys,ys[1:]):
            if not(low<=(a+b)/2<=high and y0<=(c+d)/2<=y1):continue
            if any(h[0]<(a+b)/2<h[1] and h[2]<(c+d)/2<h[3] for h in holes):continue
            center=((a+b)/2,(c+d)/2,fixed) if axis=='x' else (fixed,(c+d)/2,(a+b)/2)
            dims=(b-a,d-c,.11) if axis=='x' else (.11,d-c,b-a)
            box(name+'_cladding',center,dims,'wall')
            # Folded seams have a structural rhythm, rather than neon stripes.
            for k in range(math.ceil((b-a)/.55)):
                t=a+.15+k*.55
                if t>=b:continue
                pos=(t,(c+d)/2,fixed+.065) if axis=='x' else (fixed+.065,(c+d)/2,t)
                size=(.025,d-c,.02) if axis=='x' else (.02,d-c,.025)
                box(name+'_panel_seam',pos,size,'trim')
    for h in holes:
        a,b,c,d=h
        def piece(t,y,l,ht,mat='trim'):
            box(name+'_opening_frame',(t,y,fixed) if axis=='x' else (fixed,y,t),(l,ht,.15) if axis=='x' else (.15,ht,l),mat)
        for t in (a-.04,b+.04):piece(t,(c+d)/2,.08,d-c+.12)
        for y in (c-.04,d+.04):piece((a+b)/2,y,b-a,.08)
        if 3.5<c<5.5:
            piece((a+b)/2,(c+d)/2,b-a-.08,d-c-.08,'glass')
            for t in (a+(b-a)/3,a+2*(b-a)/3):piece(t,(c+d)/2,.035,d-c)
        elif c<.3:
            piece((a+b)/2,d+.16,b-a,.30,'roof')


def stair_flight(x,za,zb,ya,yb):
    n=math.ceil((yb-ya)/.2)
    for i in range(n):
        t=(i+.5)/n
        box('stair_grating_tread',(x,ya+(yb-ya)*(i+1)/n,za+(zb-za)*t),(.9,.065,abs(zb-za)/n+.02),'trim')
    for dx in (-.44,.44):
        a=(x+dx,ya-.12,za);b=(x+dx,yb-.12,zb)
        beam('stair_stringer',a,b,.09,.2)
        rail((a[0],a[1]+.14,a[2]),(b[0],b[1]+.14,b[2]))


def access_stair(a,b,width=.72):
    a,b=Vector(a),Vector(b)
    horizontal=b-a;horizontal.y=0
    right=Vector((0,1,0)).cross(horizontal).normalized()
    n=max(3,math.ceil(abs(b.y-a.y)/.19))
    for i in range(n):
        q=a.lerp(b,(i+.5)/n);q.y=a.y+(b.y-a.y)*(i+1)/n
        beam('gallery_access_tread',q-right*width/2,q+right*width/2,horizontal.length/n+.02,.06,'trim')
    for side in (-1,1):
        aa=a+right*side*width/2;bb=b+right*side*width/2
        beam('gallery_access_stringer',aa-Vector((0,.13,0)),bb-Vector((0,.13,0)),.08,.15)
        rail(aa,bb)


def station(cfg):
    for x in (-4.4,4.4):
        for z in (-3.4,3.4):
            box('station_pier',(x,.28,z),(.85,.52,.85),'concrete',.02)
            box('station_anchor_plate',(x,.565,z),(.56,.06,.56),'machined')
            section('station_main_column',(x,.6,z),(x,8.4,z),.28,.36)
    for y in (3.1,5.6,8.45):
        for z in (-3.4,3.4):section('floor_edge_girder',(-4.4,y-.17,z),(4.4,y-.17,z),.20,.32)
        for x in (-4.4,4.4):section('floor_side_girder',(x,y-.17,-3.4),(x,y-.17,3.4),.20,.32)
        for z in (-2.8,0,2.8):
            section('floor_secondary_girder',(-2.2,y-.17,z),(4.4,y-.17,z),.14,.25)
        if y==8.45:
            # Real floor opening for both gravity chutes and the lower-level
            # belt feeds, with rim beams. Do not drive them through a solid deck.
            box('roof_floor_east_north',(3.1,y-.025,-1.85),(2.6,.09,3.7),'trim')
            box('roof_floor_east_south',(3.1,y-.025,3.2),(2.6,.09,1.0),'trim')
            box('roof_floor_west',(-2.05,y-.025,0),(.5,.09,7.4),'trim')
            box('roof_floor_south',(0,y-.025,2.225),(3.6,.09,2.95),'trim')
            box('roof_floor_north',(0,y-.025,-3.5),(3.6,.09,.4),'trim')
            for x in (-1.8,1.8):
                beam('process_opening_rim',(x,y-.11,-3.3),(x,y-.11,.75),.09,.14)
                rail((x,y+.05,-3.25),(x,y+.05,-.5))
        else:box('process_floor',(1.05,y-.025,0),(6.7,.09,7.4),'trim')
        for z in (-3.15,3.15):box('stair_landing',(-3.25,y-.025,z),(2.3,.09,1.1),'trim')
    for z in (-3.4,3.4):
        for y0,y1 in ((.65,3.1),(3.1,5.6)):
            beam('station_wall_brace',(-4.4,y0,z),(-.3,y1,z),.12,.14)
            beam('station_wall_brace',(4.4,y0,z),(.3,y1,z),.12,.14)
    windows=[[-3.6,-1.8,4.15,5.3],[1.8,3.6,4.15,5.3]]
    panel_wall('south','x',3.8,-4.8,4.8,3.12,8.25,windows)
    panel_wall('north','x',-3.8,-4.8,4.8,3.12,8.25,windows+[[-2.7,2.7,5.65,8.25]])
    panel_wall('west','z',-4.8,-3.8,3.8,3.12,8.25,[[-2.3,.0,4.15,5.3]])
    panel_wall('east','z',4.8,-3.8,3.8,.12,8.25,[[-1.4,1.4,.12,2.8],[-3.2,-1.8,4.15,5.3],[1.1,3.55,7.75,8.25]])
    stair_flight(-3.4,2.7,-2.7,.12,3.1)
    stair_flight(-3.4,-2.7,2.7,3.1,5.6)
    stair_flight(-3.4,2.7,-2.7,5.6,8.45)
    # Full perimeter service deck with actual conveyor openings in the guards.
    rail((-4.7,8.5,-3.7),(-4.7,8.5,3.7));rail((-4.7,8.5,3.7),(4.7,8.5,3.7))
    for a,b in ((-4.7,-2.8),(2.8,4.7)):rail((a,8.5,-3.7),(b,8.5,-3.7))
    for a,b in ((-3.7,.6),(3.55,3.7)):rail((4.7,8.5,a),(4.7,8.5,b))
    # A weather canopy over the receiving head, supported on the station frame.
    for x in (-2.2,2.2):
        for z in (-3.0,3.0):section('head_canopy_post',(x,8.45,z),(x,10.3,z),.10,.13)
    for z in (-3.0,3.0):beam('head_canopy_girder',(-2.2,10.3,z),(2.2,10.3,z),.10,.16)
    box('station_head_weather_roof',(0,10.4,0),(4.75,.12,6.35),'roof')
    # Two steep gravity branches. The existing routes stay in plan; branch
    # working belts are lower inside the tower and rise gradually to silo roofs.
    receiver=Vector((-.55,9.65,-.25))
    chute('receiving_head_collar',(-.2,9.48,-.10),(-.55,9.42,-.25),.9,.65)
    for sign in (-1,1):
        tail=Vector((sign*.98,6.631,-2.94))
        source=receiver+Vector((sign*.16,-.02,-.12))
        mouth=tail+Vector((0,.13,.0))
        chute('gravity_diverter_branch',source,mouth,.65,.6)
        angle=math.degrees(math.atan2(source.y-mouth.y,math.hypot(source.x-mouth.x,source.z-mouth.z)))
        assert angle>42,angle
        PORTS.append({'id':'station-'+str(sign),'source':list(source+Vector((-50,0,-7))),'mouth':list(mouth+Vector((-50,0,-7))),'gravitySlopeDegrees':angle,'beltY':tail.y})
    box('diverter_flap_drive',(.8,9.25,-.25),(.4,.4,.48),'steel')
    rod('diverter_actuator_shaft',(.4,9.25,-.25),(.95,9.25,-.25),.045,'machined',16)
    for item in cfg['conveyors']:
        _,_,start,end,_,v,w,_=line_frame(item)
        terminal=end if item['id']=='shaft-transfer' else start
        terminal-=Vector(cfg['station']['position'])
        datum=5.65
        belt_width=1 if item['id']=='shaft-transfer' else .9
        for sign in (-1,1):
            seat=terminal+v*sign*(belt_width/2+.16)-w*.26
            section('terminal_bearing_mount',(seat.x,datum,seat.z),(seat.x,seat.y-.18,seat.z),.10,.14)
            box('terminal_bearing_seat',(seat.x,seat.y-.15,seat.z),(.36,.09,.36),'steel')


def line_frame(cfg):
    a,b=Vector(cfg['from']),Vector(cfg['to'])
    a.y+=cfg['beltOffsets'][0];b.y+=cfg['beltOffsets'][1]
    u=(b-a).normalized();v=Vector((0,1,0)).cross(u).normalized();w=u.cross(v).normalized()
    t0,t1=cfg['trim'];start=a.lerp(b,t0);end=a.lerp(b,t1);length=(end-start).length
    return a,b,start,end,u,v,w,length


def capture_colliders(offset):
    bpy.context.view_layer.update()
    terms=('concrete_silo_wall','silo_roof','roof_guardrail','roof_rail_post','ladder_',
           'cage_','roof_grating','grating_band','head_deck_post','head_service_grating',
           'station_main_column','process_floor','roof_floor','stair_','head_canopy_',
           'station_head_weather_roof','guardrail','rail_post','floor_secondary_girder')
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or not (obj.name.startswith(terms) or '_cladding' in obj.name):continue
        vs=[obj.matrix_world@v.co+p.xyz(offset) for v in obj.data.vertices]
        COLLIDERS.append((obj.name,BVHTree.FromPolygons(vs,[tuple(f.vertices) for f in obj.data.polygons])))


def check_passages(cfg):
    """Ray tests on actual authored wall/floor/rail triangles, before joins.
    Intentional terminal bearing mounts, rollers and receiving chute interfaces
    are excluded. Test both flights and both truss chords through all buildings.
    """
    hits=[];queries=0
    for item in cfg['conveyors']:
        _,_,start,end,_,v,w,_=line_frame(item)
        width=1 if item['width']==1.8 else .9
        tracks=[(x,y) for x in (-width/2,0,width/2) for y in (0,-.51)]
        tracks += [(x,y) for x in (-.68,.68) for y in (-.85,-.22)]
        for x,y in tracks:
            aa=p.xyz(start+v*x+w*y);bb=p.xyz(end+v*x+w*y)
            direction=bb-aa;distance=direction.length;direction.normalize()
            for name,tree in COLLIDERS:
                queries+=1
                if tree.ray_cast(aa,direction,distance)[0] is not None:hits.append((item['id'],name,x,y))
    assert not hits, 'Belt/frame penetrates stationary structure: '+str(hits[:30])
    return {'triangleRayQueries':queries,'stationaryStructureHits':[],
            'tested':'carrying and return flights, both edges, both upper/lower truss chords; authored wall/floor/guard geometry'}


def conveyor(cfg,params):
    a,b,start,end,u,v,w,length=line_frame(cfg)
    belt_width=1.0 if cfg['width']==1.8 else .9
    def pos(t,x=0,y=0):return start+u*t+v*x+w*y
    # Trough belt surface flattens smoothly over the end drums.
    stations=math.ceil(length/.75)
    verts=[]
    for i in range(stations+1):
        t=length*i/stations;factor=min(1,t/1.1,(length-t)/1.1)
        for x,h in ((-belt_width/2,.12),(-belt_width/6,0),(belt_width/6,0),(belt_width/2,.12)):
            verts.append(pos(t,x,h*max(0,factor)))
    # Thin double-sided physical belt, with actual edge thickness.
    verts+= [v-w*.018 for v in verts]
    rows=stations+1;half=rows*4;faces=[]
    for i in range(stations):
        for j in range(3):
            k=i*4+j
            faces.extend([(k,k+1,k+5,k+4),(half+k+4,half+k+5,half+k+1,half+k)])
        for j in (0,3):
            k=i*4+j;faces.append((k,k+4,half+k+4,half+k))
    mesh(cfg['id']+'_carrying_belt',verts,[tuple(reversed(face)) for face in faces],'rubber')
    # Return flight, end wraps and guarded shaft-drive assemblies.
    plate('return_belt',[pos(0,-belt_width/2,-.502),pos(length,-belt_width/2,-.502),pos(length,belt_width/2,-.502),pos(0,belt_width/2,-.502)],'rubber',.018)
    for t,which in ((0,'tail'),(length,'head')):
        c=pos(t,0,-.26)
        rod(which+'_pulley',c-v*(belt_width/2+.08),c+v*(belt_width/2+.08),.24,'steel',32)
        rod(which+'_pulley_axle',c-v*(belt_width/2+.3),c+v*(belt_width/2+.3),.065,'machined',16)
        # Curved rubber wrap joins top and return flights, no open end.
        wrap=[]
        for i in range(17):
            angle=-math.pi/2+math.pi*i/16
            q=c+u*(math.cos(angle)*.26*(1 if which=='head' else -1))+w*math.sin(angle)*.26
            wrap.extend((q-v*belt_width/2,q+v*belt_width/2))
        for i in range(16):plate(which+'_belt_wrap',[wrap[i*2],wrap[i*2+1],wrap[i*2+3],wrap[i*2+2]],'rubber',.018)
        for side in (-1,1):
            box(which+'_bearing',list(c+v*side*(belt_width/2+.16)),(.25,.28,.25),'trim')
        if which=='head':
            c=pos(t, belt_width/2+.36,-.28)
            rod('drive_motor',c-u*.32,c+u*.32,.20,'steel',16)
            box('drive_gearbox',list(c-v*.17),(.30,.32,.4),'steel')
            for k in range(5):rod('motor_fin',c+u*(-.28+k*.12)-v*.22,c+u*(-.28+k*.12)+v*.22,.025,'trim',8)
            # Sheet guard covers coupling without enclosing the whole motor.
            box('coupling_guard',list(c-v*.30+Vector((0,.16,0))),(.45,.10,.32),'safety')
    # Upper three-roll sets with a 20-degree trough; flat return sets below.
    count=max(2,math.ceil(length/params['rollerPitch']))
    for i in range(1,count):
        t=length*i/count;factor=min(1,t/1.1,(length-t)/1.1)
        h=.12*factor
        rod('center_carry_idler',pos(t,-belt_width/6,-.085),pos(t,belt_width/6,-.085),.075,'machined',params['rollerSides'])
        for side in (-1,1):
            rod('wing_carry_idler',pos(t,side*belt_width/6,-.085),pos(t,side*belt_width/2,h-.085),.075,'machined',params['rollerSides'])
            beam('idler_end_bracket',pos(t,side*belt_width/2,-.22),pos(t,side*belt_width/2,h-.075),.035,.045,'steel')
        beam('idler_crossmember',pos(t,-.68,-.22),pos(t,.68,-.22),.08,.11,'steel')
        if i%2==0:rod('return_idler',pos(t,-belt_width/2,-.605),pos(t,belt_width/2,-.605),.085,'machined',params['rollerSides'])
    # Side Warren trusses: top chord is below carrying rollers; webs do not
    # cut the carrying flight. Wider maintenance gallery begins outside tower.
    bays=math.ceil(length/2.6)
    for side in (-1,1):
        for y in (-.85,-.22):beam('truss_chord',pos(0,side*.68,y),pos(length,side*.68,y),.095,.12,'steel')
        for i in range(bays):
            ta=length*i/bays;tb=length*(i+1)/bays
            beam('truss_diagonal',pos(ta,side*.68,-.85 if i%2==0 else -.22),pos(tb,side*.68,-.22 if i%2==0 else -.85),.065,.075,'steel')
            beam('truss_vertical',pos(ta,side*.68,-.85),pos(ta,side*.68,-.22),.07,.07,'steel')
    gallery_start=0 if cfg['id']=='shaft-transfer' else min(length,3.7)
    gallery_end=length if cfg['id']=='shaft-transfer' else max(gallery_start,length-4.9)
    for side in (-1,1):
        # Open metal grating instead of an opaque blue corridor.
        for x in (.86,1.04,1.24,1.43):beam('gallery_grating_stringer',pos(gallery_start,side*x,-.17),pos(gallery_end,side*x,-.17),.03,.06,'trim')
        n=math.ceil((gallery_end-gallery_start)/.3)
        for i in range(n+1):
            t=gallery_start+(gallery_end-gallery_start)*i/max(1,n)
            beam('gallery_grating_crossbar',pos(t,side*.78,-.16),pos(t,side*1.50,-.16),.025,.04,'trim')
        if cfg['id']=='shaft-transfer':
            rail(pos(gallery_start,side*1.52,-.13),pos(length-2.2,side*1.52,-.13))
            rail(pos(length-.3,side*1.52,-.13),pos(length,side*1.52,-.13))
            # Side exits descend onto solid parts of the station roof deck.
            aa=pos(length-1,side*1.14,-.13)
            bb=aa+Vector((0,0,1.7)) if side==1 else aa+Vector((1.5,0,0))
            bb.y=8.5
            access_stair(aa,bb)
            rail(pos(gallery_start,side*.78,-.13),pos(gallery_start,side*1.5,-.13))
            rail(pos(length,side*.78,-.13),pos(length,side*1.5,-.13))
        else:
            rail(pos(gallery_start,side*1.52,-.13),pos(gallery_end,side*1.52,-.13))
            rail(pos(gallery_start,side*.78,-.13),pos(gallery_start,side*1.5,-.13))
            aa=pos(gallery_end,side*1.14,-.13)
            bb=end-u*3.5+v*side*1.14;bb.y=9.84
            access_stair(aa,bb)
    for i in range(bays+1):
        t=length*i/bays
        beam('truss_crossbeam',pos(t,-.74,-.78),pos(t,.74,-.78),.095,.12,'steel')
    # Pitched, removable weather covers. One access bay is hinged open for
    # the static maintenance view, with gallery guards remaining in place.
    cover_steps=math.ceil(length/2.2)
    for i in range(cover_steps):
        ta=length*i/cover_steps;tb=length*(i+1)/cover_steps
        opened=params['inspectionCoversOpen'] and i==max(2,cover_steps-4)
        for side in (-1,1):
            edge=.65;rise=.43
            outer=pos(ta,side*edge,.15);inner=pos(ta,0,rise)
            outerb=pos(tb,side*edge,.15);innerb=pos(tb,0,rise)
            if opened:
                inner=pos(ta,side*.65,.90);innerb=pos(tb,side*.65,.90)
            plate('hinged_inspection_cover' if opened else 'weather_cover',[outer,outerb,innerb,inner],'wall')
            for t in (ta,tb):beam('cover_bow',pos(t,side*edge,.13),pos(t,0,.41),.025,.045,'trim')
    # Portal frames at the original support stations, bearings connected to
    # both truss chords. Feet stay outside all existing road rectangles.
    for support_index,t in enumerate(cfg['supports']):
        c=a.lerp(b,t);top=c.y-.90
        dx,dz=cfg.get('supportBaseOffsets',[[0,0]]*len(cfg['supports']))[support_index]
        feet=[]
        for side in (-1,1):
            head=c+v*side*1.15;q=head+Vector((dx,0,dz));feet.append([q.x,q.z])
            box('conveyor_pad',(q.x,.20,q.z),(.75,.38,.75),'concrete',.02)
            box('support_baseplate',(q.x,.42,q.z),(.46,.05,.46),'machined')
            section('conveyor_portal_leg',(q.x,.45,q.z),(head.x,top,head.z),.18,.24)
            for h in (2.6,5.0,7.4) if side==1 else ():
                if h<top-.2:
                    shift=Vector((dx,0,dz))*(1-(h-.45)/(top-.45))
                    qq=c-v*1.15+shift;qt=c+v*1.15+shift
                    beam('portal_lateral_tie',(qq.x,h,qq.z),(qt.x,h,qt.z),.10,.12)
        q0=c-v*1.15;q1=c+v*1.15
        section('portal_head_beam',(q0.x,top,q0.z),(q1.x,top,q1.z),.16,.24)
        for sign in (-1,1):
            beam('portal_diagonal',(q0.x+dx,.55,q0.z+dz),(q1.x+dx*.2,min(top,4.6),q1.z+dz*.2),.085,.10)
            if sign==1:break
        for side in (-1,1):
            q=c+v*side*.68
            box('truss_bearing_plate',(q.x,top+.12,q.z),(.42,.08,.35),'trim')
        SUPPORTS.append({'id':cfg['id'],'t':t,'feet':feet,'topY':top,'padSize':.75})
    # Terminal support: shaft structure already exists; station and silo
    # authored support beams take the other ends. Record these intended joints.
    PATHS.append({'id':cfg['id'],'referenceFrom':cfg['from'],'referenceTo':cfg['to'],
                  'beltStart':list(start),'beltEnd':list(end),'gradeDegrees':math.degrees(math.asin(u.y)),
                  'lowerTrussOffset':-.91,'headRadius':.25,'beltWidth':belt_width})


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--parameters',type=Path,default=Path(__file__).with_name('coal_transport.parameters.json'))
    parser.add_argument('--output-dir',type=Path,default=ROOT/'public/models')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    cfg=json.loads(args.parameters.read_text(encoding='utf-8-sig'))
    protected=json.loads(Path(__file__).with_name('coal_transport.protected-baseline.json').read_text(encoding='utf-8-sig'))
    assert all(hashlib.sha256((ROOT/a['path']).read_bytes()).hexdigest().upper()==a['hash'] for a in protected)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    materials();outputs=[]
    for i,item in enumerate(cfg['silos']):
        p.reset();approach=line_frame(cfg['conveyors'][i+1])[4]
        silo(item,approach)
        capture_colliders(item['position'])
        outputs.append(p.export(args.output_dir/('mine-coal-silo-'+str(i+1)+'.glb')))
    p.reset();station(cfg);capture_colliders(cfg['station']['position'])
    clearance=check_passages(cfg)
    outputs.append(p.export(args.output_dir/'mine-transfer-station.glb'))
    p.reset()
    for item in cfg['conveyors']:conveyor(item,cfg)
    outputs.append(p.export(args.output_dir/'mine-coal-conveyors.glb'))
    assert sum(a['triangles'] for a in outputs)<cfg['maximumTotalTriangles']
    assert all(hashlib.sha256((ROOT/a['path']).read_bytes()).hexdigest().upper()==a['hash'] for a in protected)
    report={'outputs':outputs,'interfaces':PORTS,'supports':SUPPORTS,'paths':PATHS,'parameters':cfg,'clearance':clearance,
            'protectedFilesUnchanged':True,'referenceImagesUsedAsTextures':False,
            'maintenanceState':'one hinged inspection bay per conveyor; static, no simulation'}
    (args.output_dir/'mine-coal-transport.report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('COAL_TRANSPORT_EXPORT_OK '+json.dumps({'outputs':outputs,'protectedFilesUnchanged':True}))


if __name__=='__main__':main()
