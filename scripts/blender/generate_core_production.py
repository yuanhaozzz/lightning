"""Phase 3 only: detailed buildings and a physically continuous hoisting rope.

Run blender.exe -b --factory-startup --python-exit-code 1 --python this_file
Optional -- --parameters custom.json --output-dir public/models
Coordinates in the parameter file match Three.js: meters, Y up, +Z south.
The existing headframe is read for collision checks only. Never re-export it.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_mine_headframe as primitives

ROOT = Path(__file__).resolve().parents[2]
M = {}
OPENINGS = []
ROPE_POINTS = []


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def box(name, center, size, mat, bevel=0):
    return primitives.box(name, xyz(center), (size[0], size[2], size[1]), M[mat], bevel)


def beam(name, a, b, width=.12, depth=.18, mat='steel'):
    return primitives.beam(name, xyz(a), xyz(b), width, depth, M[mat])


def section(name, a, b, width=.22, depth=.3, mat='steel'):
    return primitives.section(name, xyz(a), xyz(b), width, depth, .016, M[mat])


def rod(name, a, b, radius, mat, vertices=16):
    return primitives.rod(name, xyz(a), xyz(b), radius, M[mat], vertices)


def mesh(name, verts, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in verts], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return primitives.finish(obj, name, M[mat])


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    primitives.RAIL_POSTS.clear()


def materials():
    palette = {
        'concrete': ((.46, .48, .46), 0, .9, 'concrete'),
        'wall': ((.62, .64, .60), 0, .85, 'concrete'),
        'roof': ((.075, .19, .26), .45, .42, 'steel'),
        'steel': ((.12, .19, .22), .68, .43, 'steel'),
        'trim': ((.38, .44, .46), .75, .38, None),
        'glass': ((.075, .17, .21), .2, .18, None),
        'safety': ((.81, .46, .085), .2, .48, None),
        'machine': ((.055, .21, .24), .65, .4, 'steel'),
        'machined': ((.34, .37, .40), .92, .26, None),
        'dark': ((.035, .043, .045), .25, .8, None),
        'rope': ((.29, .31, .32), .88, .44, None),
    }
    for key, values in palette.items():
        M[key] = primitives.material('Core_' + key, *values)


def wall(name, axis, fixed, low, high, height, holes):
    """Panelize around actual openings. Windows/doors never sit on a solid wall."""
    xs = sorted(set([low, high] + [v for h in holes for v in h[:2]]))
    ys = sorted(set([.12, height] + [v for h in holes for v in h[2:]]))
    for a, b in zip(xs, xs[1:]):
        for c, d in zip(ys, ys[1:]):
            if any(h[0] < (a+b)/2 < h[1] and h[2] < (c+d)/2 < h[3] for h in holes):
                continue
            if axis == 'x':
                box(name+'_panel', ((a+b)/2, (c+d)/2, fixed), (b-a, d-c, .2), 'wall')
            else:
                box(name+'_panel', (fixed, (c+d)/2, (a+b)/2), (.2, d-c, b-a), 'wall')
    for i, h in enumerate(holes):
        OPENINGS.append({'wall': name, 'rectangle': h, 'axis': axis, 'fixed': fixed})
        a, b, c, d = h
        def piece(label, along, vertical, length, tall, thickness=.1, mat='trim'):
            center = (along, vertical, fixed) if axis == 'x' else (fixed, vertical, along)
            dims = (length, tall, thickness) if axis == 'x' else (thickness, tall, length)
            box(name+'_'+label+str(i), center, dims, mat)
        for along in (a-.045, b+.045):
            piece('jamb', along, (c+d)/2, .09, d-c+.18)
        for vertical in (c-.045, d+.045):
            piece('lintel', (a+b)/2, vertical, b-a, .09)
        if c > .5:  # glazed industrial window, or a genuinely open rope entry
            if name == 'hoist_west' and i == 0:
                continue
            piece('glass', (a+b)/2, (c+d)/2, b-a-.04, d-c-.04, .025, 'glass')
            for k in range(1, 4):
                piece('mullion', a+(b-a)*k/4, (c+d)/2, .045, d-c)
            piece('transom', (a+b)/2, (c+d)/2, b-a, .04)
        else:
            # Open workshop gate: shutter stored above the clear doorway.
            piece('raised_shutter', (a+b)/2, min(height-.22, d+.23), b-a, .36, .12, 'roof')
            for along in (a-.12, b+.12):
                piece('door_track', along, (c+d)/2, .055, d-c, .12, 'steel')


def roof(w, d, eaves, peak, slot=None):
    # Closed roof panels with thickness, ridge flashing, and standing seams.
    for sign in (-1, 1):
        z0, z1 = 0, sign*(d/2+.22)
        xs=sorted([-w/2-.18,w/2+.18]+(list(slot) if slot else []))
        for xa,xb in zip(xs,xs[1:]):
            za=sign*.8 if slot and slot[0] <= (xa+xb)/2 <= slot[1] else 0
            ya=peak-(peak-eaves)*abs(za)/(d/2+.22)
            verts=[(xa,ya,za),(xb,ya,za),(xb,eaves,z1),(xa,eaves,z1)]
            verts += [(x,y-.09,z) for x,y,z in verts]
            mesh('roof_panel',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'roof')
        for x in [(-w/2-.12)+i*.55 for i in range(math.ceil(w/.55)+1)]:
            za=sign*.8 if slot and slot[0]-.04<x<slot[1]+.04 else 0
            ya=peak-(peak-eaves)*abs(za)/(d/2+.22)
            beam('roof_standing_seam',(x,ya+.035,za),(x,eaves+.035,z1),.025,.04,'roof')
        rod('eaves_gutter', (-w/2-.2,eaves-.08,z1), (w/2+.2,eaves-.08,z1), .075, 'trim')
        for x in (-w/2+.18,w/2-.18):
            rod('rainwater_downpipe', (x,eaves-.12,z1),(x,.18,z1),.06,'trim')
    spans=[(-w/2-.2,slot[0]),(slot[1],w/2+.2)] if slot else [(-w/2-.2,w/2+.2)]
    for xa,xb in spans:box('ridge_flashing',((xa+xb)/2,peak+.035,0),(xb-xa,.06,.17),'trim')
    if slot:
        for x in slot:
            beam('rope_roof_opening_header',(x,peak-.18,-.85),(x,peak-.18,.85),.12,.18)
        for z in (-.8,.8):
            beam('rope_opening_flashing',(slot[0],peak-.03,z),(slot[1],peak-.03,z),.09,.15,'trim')
    for x in (-w/2,w/2):
        mesh('gable',[(x,eaves,-d/2),(x,eaves,d/2),(x,peak,0)],[(0,1,2),(2,1,0)],'wall')


def structure(w,d,eaves,peak,slot=None):
    # Portal lines flank door jambs. No structural post blocks an open bay.
    frame_xs=[-4.68,-2.0,2.0,4.68] if w==10 else [-9.68,-7.75,-2.25,1.65,5.6,9.68]
    for x in frame_xs:
        for z in (-d/2+.32,d/2-.32):
            section('portal_column',(x,.2,z),(x,eaves-.18,z))
            box('column_plinth',(x,.3,z),(.5,.36,.5),'concrete',.015)
            box('column_baseplate',(x,.5,z),(.4,.035,.4),'machined')
        for sign in (-1,1):
            section('roof_rafter',(x,eaves-.2,sign*(d/2-.32)),(x,peak-.18,0),.18,.24)
        beam('truss_tie',(x,eaves-.35,-d/2+.32),(x,eaves-.35,d/2-.32),.09,.12)
        beam('truss_kingpost',(x,eaves-.35,0),(x,peak-.18,0),.07,.10)
    for z in (-d*.4,-d*.2,0,d*.2,d*.4):
        y=peak-.16-(peak-eaves)*abs(z)/(d/2)
        spans=[(-w/2+.25,slot[0]),(slot[1],w/2-.25)] if slot and z==0 else [(-w/2+.25,w/2-.25)]
        for a,b in spans:beam('roof_purlin',(a,y,z),(b,y,z),.07,.1)


def building(kind, cfg, port_height):
    w, peak, d = cfg['size']
    eaves=cfg['eaves']
    slot=(port_height-cfg['position'][0]-.8,port_height-cfg['position'][0]+.8) if kind=='hoist' else None
    box('floor_slab',(0,.035,0),(w,.13,d),'concrete')
    structure(w,d,eaves,peak,slot)
    if kind=='shaft':
        south=[[-1.8,1.8,.13,2.95],[-4.4,-2.6,1.55,2.8],[2.6,4.4,1.55,2.8]]
        north=[[-1.8,1.8,.13,2.95]]
        sides=[[-2.8,-.6,1.55,2.8],[.6,2.8,1.55,2.8]]
    else:
        south=[[-7.5,-2.5,.13,4.45],[2,5,2.25,4.65],[6,9,2.25,4.65]]
        north=[[-7.4,-4.3,2.25,4.65],[-1.85,1.25,2.25,4.65],[2,5,2.25,4.65],[6,9,2.25,4.65]]
        sides=[[-4.6,-2.4,2.25,4.65],[2.4,4.6,2.25,4.65]]
    wall(kind+'_south','x',d/2,-w/2,w/2,eaves,south)
    wall(kind+'_north','x',-d/2,-w/2,w/2,eaves,north)
    wall(kind+'_east','z',w/2,-d/2,d/2,eaves,sides)
    west = sides
    wall(kind+'_west','z',-w/2,-d/2,d/2,eaves,west)
    # Foundation band and column pilasters reveal building construction.
    for sign in (-1,1):
        for x in (-w/2,-w/4,0,w/4,w/2):
            # Keep open workshop doors unobstructed.
            holes=south if sign==1 else north
            if not any(h[0]-.15 < x < h[1]+.15 for h in holes):
                box('wall_pilaster',(x,eaves/2,sign*(d/2+.08)),(.18,eaves,.12),'concrete')
    roof(w,d,eaves,peak,slot)
    if kind=='hoist':
        # Industrial ventilation above the drive side, not invented piping.
        for x in (3.5,7.5):
            box('vent_frame',(x,5.23,d/2+.12),(1.35,.48,.13),'trim')
            for k in range(5):
                box('vent_louver',(x,5.05+k*.075,d/2+.21),(1.24,.035,.08),'steel')
    # Corner lamps point at the immediate doorway; emissive material stays mild.
    for x in (-w/2+.45,w/2-.45):
        box('doorway_bulkhead_light',(x,eaves-.35,d/2+.18),(.22,.13,.1),'trim')


def hoist_machine(cfg, rope_cfg):
    c=Vector(rope_cfg['drumCenter'])-Vector(cfg['position'])
    x,y,z=c
    r=rope_cfg['drumRadius']
    box('machine_foundation',(x,.43,z),(3.6,.65,4.3),'concrete',.025)
    rod('drum_barrel',(x,y,z-1.3),(x,y,z+1.3),r,'machine',64)
    for dz in (-1.36,1.36):
        rod('drum_flange',(x,y,z+dz-.045),(x,y,z+dz+.045),r+.13,'machined',64)
    # One continuous helix joins the active rope at the drum tangent; no stack
    # of decorative closed rings. 26 turns at 48 mm pitch leave room to spool.
    g=Vector(rope_cfg['guideCenters'][1][:2]);dc=Vector(rope_cfg['drumCenter'][:2])
    _,_,normal=tangent(g,rope_cfg['guideRadius']+rope_cfg['radius'],dc,r+rope_cfg['radius'],1)
    angle=math.atan2(normal.y,normal.x)
    path=[]
    for i in range(833):
        t=i/832;a=angle-t*math.tau*26
        path.append(Vector((x+(r+rope_cfg['radius'])*math.cos(a),y+(r+rope_cfg['radius'])*math.sin(a),z-t*1.248)))
    tube_mesh('wound_rope',path,rope_cfg['radius'],'rope',6)
    rod('drum_axle',(x,y,z-2.15),(x,y,z+4.8),.15,'machined',32)
    for dz in (-1.85,1.85):
        box('bearing_pedestal',(x,1.18,z+dz),(.85,1.1,.65),'steel',.02)
        rod('bearing_housing',(x,y,z+dz-.22),(x,y,z+dz+.22),.3,'machine',32)
        rod('brake_disc',(x,y,z+dz-.30),(x,y,z+dz-.23),.86,'machined',48)
        for dx in (-.65,.65):
            box('disc_brake_caliper',(x+dx,y,z+dz-.265),(.30,.55,.3),'safety',.015)
    rod('drive_coupling',(x,y,z+2.2),(x,y,z+2.5),.28,'machined',24)
    rod('direct_drive_motor',(x,y,z+2.65),(x,y,z+4.4),.68,'machine',32)
    box('motor_plinth',(x,.8,z+3.5),(1.5,1.35,2),'concrete',.02)
    for i in range(12):
        ring('motor_cooling_fin',(x,y,z+2.75+i*.13),.72,.024,'steel',32)
    for a,b in (((x-1.95,.1,z-2.4),(x-1.95,.1,z+4.7)),((x+1.95,.1,z-2.4),(x+1.95,.1,z+4.7))):
        primitives.rail('machine_safety_guard',xyz(a),xyz(b),M['safety'],M['steel'])


def ring(name, c, radius, tube, mat, steps=48):
    # Rings are in the X/Y plane, axle is depth/Z, matching the existing sheave.
    verts=[]
    for i in range(steps):
        a=i*math.tau/steps
        for j in range(8):
            b=j*math.tau/8
            rr=radius+tube*math.cos(b)
            verts.append((c[0]+rr*math.cos(a),c[1]+rr*math.sin(a),c[2]+tube*math.sin(b)))
    faces=[(i*8+j,((i+1)%steps)*8+j,((i+1)%steps)*8+(j+1)%8,i*8+(j+1)%8) for i in range(steps) for j in range(8)]
    obj=mesh(name,verts,faces,mat)
    for p in obj.data.polygons:p.use_smooth=True
    return obj


def tube_mesh(name,points,radius,mat,sides=8):
    verts=[]
    for i,p in enumerate(points):
        tangent_dir=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        normal=tangent_dir.cross(Vector((0,0,1))).normalized()
        binormal=tangent_dir.cross(normal).normalized()
        for j in range(sides):
            a=j*math.tau/sides
            verts.append(p+radius*(normal*math.cos(a)+binormal*math.sin(a)))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j)
           for i in range(len(points)-1) for j in range(sides)]
    obj=mesh(name,verts,faces,mat)
    for face in obj.data.polygons:face.use_smooth=True


def tangent(c1,r1,c2,r2,side=1):
    """External common tangent; its radial normal determines rope wrap direction."""
    delta=c2-c1
    u=delta.normalized()
    k=(r1-r2)/delta.length
    n=u*k+Vector((-u.y,u.x))*side*math.sqrt(1-k*k)
    return c1+r1*n,c2+r2*n,n


def rope_geometry(cfg):
    h=cfg['headframe'];r=cfg['rope']
    main=Vector(((h['sheaveCenter'][0]-h['sourceCenterX'])*h['scale']+h['position'][0],(h['sheaveCenter'][1]-h['sourceGroundY'])*h['scale']))
    g1,g2=[Vector(c[:2]) for c in r['guideCenters']]
    drum=Vector(r['drumCenter'][:2]);tube=r['radius']
    radii=[h['grooveRadius']*h['scale']+tube,r['guideRadius']+tube,r['guideRadius']+tube,r['drumRadius']+tube]
    # Internal tangent changes rotation sense between main and west guide.
    a,b,n1=tangent(main,radii[0],g1,-radii[1],-1)
    c,d,n2=tangent(g1,radii[1],g2,radii[2],1)
    e,f,n3=tangent(g2,radii[2],drum,radii[3],1)
    points=[Vector((main.x+radii[0],.35,-6)),Vector((main.x+radii[0],main.y,-6))]
    def arc(center,radius,start,end):
        # Continuous reverse route: shaft up, main CCW, west guide clockwise,
        # east guide clockwise, then drum. No incompatible tangent joins.
        for i in range(1,49):
            t=start+(end-start)*i/48
            points.append(Vector((center.x+radius*math.cos(t),center.y+radius*math.sin(t),-6)))
    angle1=math.atan2(n1.y,n1.x)
    if angle1<0:angle1+=math.tau
    arc(main,radii[0],0,angle1)
    points.append(Vector((b.x,b.y,-6)))
    # Incoming direction at g1 is up-left; its radial normal is opposite to
    # the main sheave, so the clockwise arc ends with a rightward top tangent.
    arc(g1,radii[1],angle1+math.pi,math.pi/2)
    points.append(Vector((d.x,d.y,-6)))
    angle3=math.atan2(n3.y,n3.x)
    arc(g2,radii[2],math.pi/2,angle3)
    points.append(Vector((f.x,f.y,-6)))
    direction_checks=[Vector((-n1.y,n1.x)).dot((b-a).normalized()),
                      Vector((1,0)).dot((d-c).normalized()),
                      Vector((n3.y,-n3.x)).dot((f-e).normalized())]
    assert min(direction_checks)>.999, direction_checks
    for i,(p,q) in enumerate(zip(points,points[1:])):
        if (q-p).length>.0001:rod('active_hoist_rope_'+str(i),p,q,tube,'rope',8)
    ROPE_POINTS.extend(points)
    # The preserved house is 7 m high: the descending rope enters through a
    # framed roof slot, rather than clipping the roof or inventing a wall entry.
    port=e.x+(f.x-e.x)*(cfg['hoistHouse']['size'][1]-e.y)/(f.y-e.y)
    assert 4.8 < port < 22,port
    return port, {'sheaveWorldCenter':[main.x,main.y,-6], 'sheaveRopeRadius':radii[0],
                  'ropeRoofEntry':[port,cfg['hoistHouse']['size'][1],-6],'guideCenters':r['guideCenters'],
                  'mainWrapDegrees':math.degrees(angle1),'activeRopeDiameter':tube*2,
                  'ropeDirectionJoinDotProducts':direction_checks,
                  'tangentResiduals':[abs((b-a).normalized().dot(n1)),abs((f-e).normalized().dot(n3))]}


def guide_assembly(cfg):
    r=cfg['rope']
    for i,c in enumerate(r['guideCenters']):
        profile=[(-.15,.57),(-.15,.73),(-.105,.73),(-.06,.67),(0,.65),(.06,.67),(.105,.73),(.15,.73),(.15,.57)]
        verts=[]
        for k in range(64):
            angle=k*math.tau/64
            for dz,rr in profile:verts.append((c[0]+rr*math.cos(angle),c[1]+rr*math.sin(angle),c[2]+dz))
        n=len(profile)
        faces=[(k*n+j,k*n+(j+1)%n,((k+1)%64)*n+(j+1)%n,((k+1)%64)*n+j) for k in range(64) for j in range(n)]
        wheel=mesh('guide_grooved_rim',verts,faces,'machined')
        for face in wheel.data.polygons:face.use_smooth=True
        rod('guide_hub',(c[0],c[1],c[2]-.16),(c[0],c[1],c[2]+.16),.18,'machined',32)
        for k in range(8):
            a=k*math.tau/8
            rod('guide_spoke',(c[0]+.16*math.cos(a),c[1]+.16*math.sin(a),c[2]),(c[0]+.60*math.cos(a),c[1]+.60*math.sin(a),c[2]),.038,'steel')
        rod('guide_axle',(c[0],c[1],c[2]-.8),(c[0],c[1],c[2]+.8),.095,'machined',24)
        for z in (-6.65,-5.35):
            box('guide_bearing',(c[0],c[1],z),(.35,.32,.26),'machine',.012)
            section('guide_bearing_stand',(c[0],25.35,z),(c[0],26.35,z),.16,.22)
    # Rope bypass gantry: top chord is below the horizontal rope and above the
    # original head sheave. West support attaches to the existing western legs;
    # east mast stands clear of the exterior maintenance staircase.
    for z in (-7.0,-5.0):
        for y in (24.95,25.35):
            section('bypass_truss_chord',(-20.5,y,z),(-5.0,y,z),.18,.28)
        for j in range(10):
            xa=-20.5+j*1.55
            beam('bypass_truss_web',(xa,24.95,z),(xa+1.55,25.35,z),.08,.1)
        section('west_extension',(-18.8,19.95,z),(-20.2,25.35,z),.22,.30)
        section('west_extension_knee',(-18.8,22,z),(-20.2,24.95,z),.16,.22)
    for x in (-6.15,-5.05):
        for z in (-8,-4):
            box('guide_mast_foundation',(x,.13,z),(.85,.3,.85),'concrete',.025)
            section('guide_mast_column',(x,.3,z),(x,25.35,z),.26,.32)
            for y in (5.3,10.3,15.3,20.3,25.3):
                beam('guide_mast_depth_tie',(x,y,-8),(x,y,-4),.12,.18)
                beam('guide_mast_depth_brace',(x,y-5,-8),(x,y,-4),.08,.1)
    for z in (-8,-4):
        for y in (5.3,10.3,15.3,20.3,25.3):
            beam('guide_mast_width_tie',(-6.15,y,z),(-5.05,y,z),.12,.18)
            beam('guide_mast_width_brace',(-6.15,y-5,z),(-5.05,y,z),.075,.095)
    for x in (-20.2,-17.2,-14.2,-11.2,-8.2,-5.6):
        section('bypass_crossbeam',(x,25.25,-7.1),(x,25.25,-4.9),.13,.2)
    # Fixed maintenance ladder at north edge, clear of the rope plane.
    for x in (-6.08,-5.42):
        rod('mast_ladder_stringer',(x,.4,-8.25),(x,26.65,-8.25),.035,'safety')
    for i in range(84):
        y=.55+i*.30
        rod('mast_ladder_rung',(-6.08,y,-8.25),(-5.42,y,-8.25),.018,'trim')
    for i in range(23):
        y=3.25+i
        hoop=[Vector((-5.75+.43*math.cos(k*math.pi/12),y,-8.25-.65*math.sin(k*math.pi/12))) for k in range(13)]
        tube_mesh('ladder_cage_hoop',hoop,.016,'safety',6)
    for angle in (.25*math.pi,.5*math.pi,.75*math.pi):
        x=-5.75+.43*math.cos(angle);z=-8.25-.65*math.sin(angle)
        rod('ladder_cage_stringer',(x,3.25,z),(x,25.25,z),.015,'safety')
    primitives.grate('guide_service_deck',-6.3,-5,4.05,8.7,25.55,M['trim'],spacing=.09,
                     holes=((-6.08,-5.42,8.15,8.5),(-5.77,-5.43,6.49,6.81),(-5.77,-5.43,5.19,5.51)))
    for a,b in (((-6.3,25.55,-8.7),(-5,25.55,-8.7)),((-6.3,25.55,-4.05),(-5,25.55,-4.05)),
                ((-6.3,25.55,-8.7),(-6.3,25.55,-4.05)),((-5,25.55,-8.7),(-5,25.55,-4.05))):
        primitives.rail('guide_service_guard',xyz(a),xyz(b),M['safety'],M['steel'])
    # Intermediate guarded rest platforms every 6 m, on the north side only.
    for y in (6.3,12.3,18.3,24.3):
        primitives.grate('ladder_rest',-6.3,-5.1,8.15,9.15,y,M['trim'],spacing=.1,
                         holes=((-6.08,-5.42,8.15,8.5),))
        for a,b in (((-6.3,y,-9.15),(-5.1,y,-9.15)),((-6.3,y,-9.15),(-6.3,y,-8.15))):
            primitives.rail('rest_guard',xyz(a),xyz(b),M['safety'],M['steel'])
        beam('rest_bracket',(-5.6,y-1,-8),(-5.6,y,-9.1),.09,.14)


def site_details():
    # House perimeter aprons; keep all configured roads and the shaft opening.
    for x,z,w,d in ((-14,7,10,8),(14,-6,20,12)):
        for sign in (-1,1):
            box('concrete_side_apron',(x+sign*(w/2+.65),.065,z),(1.3,.10,d+2.6),'concrete')
            box('concrete_end_apron',(x,.065,z+sign*(d/2+.65)),(w,.10,1.3),'concrete')
        # Bollards protect building corners while leaving door/access axes clear.
        for dx in (-w/2+.5,w/2-.5):
            rod('door_corner_bollard',(x+dx,.12,z+d/2+.6),(x+dx,.95,z+d/2+.6),.075,'safety')
    # Covered personnel passage from the retained shaft apron to shaft-house
    # north doorway. The original shaft safety fence remains intact.
    box('shaft_access_walk',(-14,.065,1.25),(3.6,.10,3.5),'concrete')
    box('shaft_access_canopy',(-14,3.35,1.25),(4,.12,3.5),'roof')
    for x in (-15.85,-12.15):
        for z in (-.4,2.9):
            section('passage_column',(x,.12,z),(x,3.3,z),.13,.18)
        beam('passage_eaves',(x,3.3,-.5),(x,3.3,3),.1,.16)
        primitives.rail('passage_guard',xyz((x,.12,-.4)),xyz((x,.12,2.9)),M['safety'],M['steel'])
    # Short, supported discharge transition to the untouched elevated belt
    # endpoint at (-19,5.8,7). A covered chute bridges the 4.5 m roof datum.
    box('shaft_discharge_curb',(-18.5,4.65,7),(1.35,.45,2.15),'steel')
    box('shaft_discharge_chute',(-18.85,5.3,7),(1.1,1.15,1.8),'roof')
    for z in (5.9,8.1):
        section('discharge_support',(-18.4,.13,z),(-18.4,5.65,z),.16,.2)


def export(path):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    source_count=len(objects)
    for obj in objects:
        if not obj.data.uv_layers:
            uv=obj.data.uv_layers.new(name='UVMap')
            for poly in obj.data.polygons:
                axis=max(range(3),key=lambda i:abs(poly.normal[i]))
                axes=[i for i in range(3) if i!=axis]
                for loop in poly.loop_indices:
                    v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                    uv.data[loop].uv=(v[axes[0]],v[axes[1]])
    for mat in M.values():
        members=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.materials) and o.data.materials[0]==mat]
        if not members:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in members:o.select_set(True)
        bpy.context.view_layer.objects.active=members[0]
        bpy.ops.object.join()
        bpy.context.object.name=mat.name
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    result=bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,
        export_cameras=False,export_lights=False,export_animations=False)
    assert result=={'FINISHED'}
    triangles=sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons)
    assert triangles<60000,triangles
    return {'file':path.name,'triangles':triangles,'meshes':len(list(bpy.context.scene.objects)),
            'sourcePieces':source_count,'bytes':path.stat().st_size}


def check_existing_headframe(cfg):
    """Nearest-distance checks on actual preserved GLB triangles, not AABBs."""
    reset()
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/mine-headframe.glb'))
    h=cfg['headframe']
    placement=Matrix.Translation(xyz((h['position'][0]-h['sourceCenterX']*h['scale'],
                                     h['position'][1]-h['sourceGroundY']*h['scale'],h['position'][2])))@Matrix.Scale(h['scale'],4)
    trees=[]
    for o in bpy.context.scene.objects:
        if o.type!='MESH' or any(s in o.name for s in ('Cast_sheave','Sheave_groove')):continue
        trees.append((o.name,BVHTree.FromPolygons([placement@o.matrix_world@v.co for v in o.data.vertices],
                                               [tuple(p.vertices) for p in o.data.polygons])))
    hits=[];nearest=1000;checks=0
    for a,b in zip(ROPE_POINTS,ROPE_POINTS[1:]):
        for i in range(max(2,math.ceil((b-a).length/.015))):
            p=xyz(a.lerp(b,i/max(1,math.ceil((b-a).length/.015)-1)))
            for name,tree in trees:
                q=tree.find_nearest(p);checks+=1
                if q[0] is None:continue
                nearest=min(nearest,q[3])
                if q[3]<cfg['rope']['radius']+.005:hits.append(name)
    assert not hits, f'Rope intersects retained frame: {sorted(set(hits))}'
    return {'retainedFrameDistanceQueries':checks,'ropeStationaryMinimumClearance':nearest-cfg['rope']['radius'],
            'retainedFrameRopeCollisions':[]}


def check_new_rope_clearance(cfg,offset=(0,0,0)):
    """Check added stationary parts, including the actual roof-slot geometry.

    Grooved rims and wound rope intentionally contact the active rope. Other
    mechanical parts, columns, roof, walls and gantry must remain clear.
    """
    bpy.context.view_layer.update()
    trees=[]
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or obj.name.startswith(('active_hoist_rope','wound_rope','guide_grooved_rim','drum_barrel')):continue
        vertices=[obj.matrix_world@v.co+xyz(offset) for v in obj.data.vertices]
        trees.append((obj.name,BVHTree.FromPolygons(vertices,[tuple(p.vertices) for p in obj.data.polygons])))
    min_clearance=1000;hits=[];count=0
    for a,b in zip(ROPE_POINTS,ROPE_POINTS[1:]):
        n=max(2,math.ceil((b-a).length/.025))
        for i in range(n):
            p=xyz(a.lerp(b,i/(n-1)))
            for name,tree in trees:
                q=tree.find_nearest(p);count+=1
                if q[0] is None:continue
                min_clearance=min(min_clearance,q[3]-cfg['rope']['radius'])
                if q[3]<cfg['rope']['radius']-.001:hits.append(name)
    assert not hits, f'Rope intersects new structure: {sorted(set(hits))}'
    return {'queries':count,'minimumClearance':min_clearance,'collisions':[]}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--parameters',type=Path,default=Path(__file__).with_name('core_production.parameters.json'))
    parser.add_argument('--output-dir',type=Path,default=ROOT/'public/models')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    cfg=json.loads(args.parameters.read_text(encoding='utf-8-sig'))
    protected=[ROOT/'public/models/mine-headframe.glb',Path(primitives.__file__)]
    before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    args.output_dir.mkdir(parents=True,exist_ok=True)
    materials();reset()
    port,alignment=rope_geometry(cfg)
    report={'parameters':cfg,'alignment':alignment,'outputs':[]}
    report['clearance']=check_existing_headframe(cfg)
    reset();building('shaft',cfg['shaftHouse'],port)
    report['outputs'].append(export(args.output_dir/cfg['outputs'][0]))
    reset();building('hoist',cfg['hoistHouse'],port);hoist_machine(cfg['hoistHouse'],cfg['rope'])
    report['hoistHouseRopeClearance']=check_new_rope_clearance(cfg,cfg['hoistHouse']['position'])
    report['outputs'].append(export(args.output_dir/cfg['outputs'][1]))
    reset();ROPE_POINTS.clear();rope_geometry(cfg);guide_assembly(cfg);site_details()
    report['linksRopeClearance']=check_new_rope_clearance(cfg)
    report['outputs'].append(export(args.output_dir/cfg['outputs'][2]))
    report['wallOpenings']=len(OPENINGS)
    report['headframeUnchanged']=all(hashlib.sha256(p.read_bytes()).hexdigest()==before[str(p)] for p in protected)
    assert report['headframeUnchanged']
    (args.output_dir/'mine-core-production.report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('CORE_PRODUCTION_EXPORT_OK '+json.dumps(report))


if __name__=='__main__':main()
