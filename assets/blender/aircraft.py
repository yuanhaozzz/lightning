"""Original AEROTWIN A320neo appearance study, asset version 0.1.

Units are metres; every argument below uses browser axes: +Y up, +Z nose,
+X aircraft port. common.py performs the sole Blender conversion (x, -z, y).
Nominal exterior limits: length 37.57, span 35.80, height 11.76; widest
fuselage 3.95. These are Airbus published external dimensions, not a claim
of engineering-grade surface reconstruction. Engine appearance is consistently
inspired by the LEAP-1A installation: round nacelle, 18 broad fan blades.

L1 door: z=13.50, sill y=3.40, top y=5.25. Its curved outer skin is about
x=1.96 at the centre. The bridge floor should end at x=2.02, y=3.40, z=13.50.
No airline marks or externally sourced model/texture data are used.
Only the caller's AEROTWIN collection receives generated objects.
"""
import math
import bpy
from common import coord, material, empty, mesh, box, cylinder, curve

AIRCRAFT_DIMENSIONS = dict(length=37.57, wingspan=35.80, height=11.76,
                           fuselage_width=3.95)
L1_DOCK = dict(position=(2.02, 3.40, 13.50), door_width=.84,
               sill_height=3.40, door_top=5.25)
TAU = math.tau

# z, horizontal radius, vertical radius, section-centre height. Smooth cubic
# interpolation preserves a continuous nose/cabin/tail silhouette.
BODY_STATIONS = [
    (-18.785, .002, .002, 5.25), (-18.55, .09, .15, 5.25),
    (-17.75, .28, .42, 5.18), (-16.4, .61, .81, 5.00),
    (-14.6, 1.00, 1.22, 4.72), (-12.8, 1.40, 1.62, 4.40),
    (-10.8, 1.78, 1.91, 4.22), (-8.8, 1.95, 2.04, 4.15),
    (-6.4, 1.975, 2.06, 4.15), (0.0, 1.975, 2.06, 4.15),
    (7.0, 1.975, 2.06, 4.15), (12.5, 1.975, 2.06, 4.15),
    (14.1, 1.975, 2.04, 4.15), (15.3, 1.91, 1.90, 4.15),
    (16.2, 1.73, 1.63, 4.12), (16.95, 1.40, 1.24, 4.02),
    # Fuller radome with a near-horizontal centreline toward its blunt tip.
    # Dense final stations round the contour without extending the 37.57 m body.
    (17.55, 1.04, .88, 3.88), (18.05, .85, .72, 3.80),
    (18.43, .57, .45, 3.76), (18.67, .32, .27, 3.75),
    (18.74, .20, .17, 3.75), (18.775, .08, .068, 3.75),
    (18.785, .002, .002, 3.75),
]


def _section(z):
    """Monotone Hermite interpolation: no radius overshoot beyond 1.975 m."""
    z = max(BODY_STATIONS[0][0], min(BODY_STATIONS[-1][0], z))
    for i in range(len(BODY_STATIONS)-1):
        a, b = BODY_STATIONS[i], BODY_STATIONS[i+1]
        if a[0] <= z <= b[0]:
            t = (z-a[0])/(b[0]-a[0])
            # Shape-preserving cubic derivatives, including flat cabin stations.
            values = []
            for k in (1, 2, 3):
                d = (b[k]-a[k])/(b[0]-a[0])
                prev = BODY_STATIONS[max(0, i-1)]
                nxt = BODY_STATIONS[min(len(BODY_STATIONS)-1, i+2)]
                dl = (a[k]-prev[k])/(a[0]-prev[0]) if i else d
                dr = (nxt[k]-b[k])/(nxt[0]-b[0]) if i+2 < len(BODY_STATIONS) else d
                m0 = 2*dl*d/(dl+d) if dl*d > 0 else 0
                m1 = 2*dr*d/(dr+d) if dr*d > 0 else 0
                h = b[0]-a[0]
                values.append((2*t**3-3*t*t+1)*a[k] + (t**3-2*t*t+t)*h*m0
                              + (-2*t**3+3*t*t)*b[k] + (t**3-t*t)*h*m1)
            return values
    return list(BODY_STATIONS[-1][1:])


def _skin(side, y, z, lift=.012):
    rx, ry, cy = _section(z)
    return (side*(rx*math.sqrt(max(.001, 1-((y-cy)/ry)**2))+lift), y, z)


def _skin_outline(side,outline,lift):
    points=[]
    for a,b in zip(outline,outline[1:]+[outline[0]]):
        count=max(1,math.ceil(math.hypot(a[0]-b[0],a[1]-b[1])/.10))
        for j in range(count):
            t=j/count
            points.append(_skin(side,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,lift))
    return points+[points[0]]


def _ring_outline(cy, cz, width, height, radius, steps=6):
    # Width is along aircraft Z, height along Y; closed CCW outline.
    out = []
    for corner_z, corner_y, start in [
        (cz+width/2-radius, cy+height/2-radius, 0),
        (cz-width/2+radius, cy+height/2-radius, 90),
        (cz-width/2+radius, cy-height/2+radius, 180),
        (cz+width/2-radius, cy-height/2+radius, 270),
    ]:
        for j in range(steps):
            a = math.radians(start+j*90/(steps-1))
            out.append((corner_y+radius*math.sin(a), corner_z+radius*math.cos(a)))
    return out


def _skin_patch(name, side, outline, mat, parent, lift=.014):
    cy = sum(p[0] for p in outline)/len(outline)
    cz = sum(p[1] for p in outline)/len(outline)
    # Map a tessellated patch to the actual shell. A large flat cockpit-pane
    # triangle cuts inside a curved nose even when all its corners are lifted.
    # Shared barycentric samples keep this patch smooth and outside the skin.
    subdivisions=max(1,min(8,math.ceil(max(math.hypot(y-cy,z-cz) for y,z in outline)/.17)))
    v=[];f=[];cache={}
    def add(y,z):
        key=(round(y,7),round(z,7))
        if key not in cache:
            cache[key]=len(v);v.append(_skin(side,y,z,lift))
        return cache[key]
    for index,p in enumerate(outline):
        q=outline[(index+1)%len(outline)]
        local={}
        for i in range(subdivisions+1):
            for j in range(subdivisions-i+1):
                u=i/subdivisions;w=j/subdivisions
                local[i,j]=add(cy*(1-u-w)+p[0]*u+q[0]*w,
                               cz*(1-u-w)+p[1]*u+q[1]*w)
        for i in range(subdivisions):
            for j in range(subdivisions-i):
                f.append((local[i,j],local[i+1,j],local[i,j+1]))
                if i+j<subdivisions-1:
                    f.append((local[i+1,j],local[i+1,j+1],local[i,j+1]))
    if side > 0: f = [tuple(reversed(x)) for x in f]
    return mesh(name, v, f, mat, parent, smooth=True)


def _body(root, mats):
    verts, faces = [], []
    zs = []
    for a,b in zip(BODY_STATIONS[:-1], BODY_STATIONS[1:]):
        segments = max(3, math.ceil((b[0]-a[0])/.25))
        zs.extend(a[0]+(b[0]-a[0])*j/segments for j in range(segments))
    zs.append(BODY_STATIONS[-1][0])
    n = 80
    for z in zs:
        rx,ry,cy = _section(z)
        verts.extend((rx*math.cos(j*TAU/n), cy+ry*math.sin(j*TAU/n), z) for j in range(n))
    for k in range(len(zs)-1):
        for j in range(n):
            a=k*n+j; an=k*n+(j+1)%n; b=(k+1)*n+j; bn=(k+1)*n+(j+1)%n
            faces.append((a,an,bn,b))
    faces += [tuple(reversed(range(n))), tuple((len(zs)-1)*n+j for j in range(n))]
    shell=mesh('Fuselage_pressure_shell', verts, faces, mats['paint'], root, smooth=True)
    # Paint the original lower shell faces. An independently faceted overlay
    # can intersect the pressure shell even with a nominal outward offset.
    shell.data.materials.append(mats['belly'])
    shell_side_faces=(len(zs)-1)*n
    for polygon in shell.data.polygons:
        if polygon.index<shell_side_faces and polygon.index%n>=n//2:
            polygon.material_index=1
    # Radome seam follows an actual fuselage section and stays understated.
    rx,ry,cy=_section(16.85)
    curve('Radome_panel_joint',[(rx*math.cos(j*TAU/80)*1.001,
          cy+ry*math.sin(j*TAU/80)*1.001,16.85) for j in range(81)],.005,mats['joint'],root)


def _cabin(root, mats):
    cabin=empty('Cabin_windows_and_doors',root)
    for side,label in ((1,'L'),(-1,'R')):
        # Main cabin windows: rounded panes independently editable; a visible
        # two-tone inset and thin frame preserve depth from grazing angles.
        for i in range(45):
            z=12.40-i*.51
            if abs(z-.65)<.36 or abs(z+.65)<.36: continue
            y=4.94
            outline=_ring_outline(y,z,.225,.345,.085)
            _skin_patch(f'{label}_cabin_window_{i+1:02d}_frame',side,
                        _ring_outline(y,z,.249,.369,.095),mats['frame'],cabin,.013)
            _skin_patch(f'{label}_cabin_window_{i+1:02d}_glass',side,outline,mats['glass'],cabin,.023)
            curve(f'{label}_window_{i+1:02d}_reflection',
                  [_skin(side,y+.105,z-.045,.027),_skin(side,y+.105,z+.044,.027)],
                  .008,mats['glass_highlight'],cabin)
        for number,z in ((1,13.50),(4,-11.25)):
            door=empty(f'Door_{label}{number}_hinge',root)
            door['pivot_browser']=list(_skin(side,4.325,z+.42,0))
            door['rotation_axis_browser']='Y'
            door['sill_height_m']=3.4
            outline=_ring_outline(4.325,z,.84,1.85,.17)
            _skin_patch(f'Door_{label}{number}_panel',side,outline,mats['door'],door,.013)
            curve(f'Door_{label}{number}_seal',
                  _skin_outline(side,outline,.027),.009,mats['joint'],door)
            _skin_patch(f'Door_{label}{number}_window',side,
                        _ring_outline(4.88,z,.20,.27,.07),mats['glass'],door,.031)
            # Handle, placard and red indicator remain distinct editable nodes.
            curve(f'Door_{label}{number}_handle',[_skin(side,4.28,z+.18,.037),
                  _skin(side,4.28,z+.31,.037)],.022,mats['metal'],door)
            _skin_patch(f'Door_{label}{number}_indicator',side,
                        _ring_outline(4.39,z+.28,.045,.085,.013),mats['red'],door,.034)
            _skin_patch(f'Door_{label}{number}_sill',side,
                        _ring_outline(3.43,z,.70,.045,.015),mats['metal'],door,.025)
        for number,z in ((2,.65),(3,-.65)):
            door=empty(f'Door_{label}{number}_overwing_exit',root)
            door['pivot_browser']=list(_skin(side,5.235,z,0))
            outline=_ring_outline(4.72,z,.55,1.03,.10)
            curve(f'Door_{label}{number}_seal',_skin_outline(side,outline,.025),
                  .007,mats['joint'],door)
            _skin_patch(f'Door_{label}{number}_window',side,
                        _ring_outline(4.94,z,.225,.345,.085),mats['glass'],door,.030)
            curve(f'Door_{label}{number}_handle',[_skin(side,4.40,z-.07,.03),
                  _skin(side,4.40,z+.07,.03)],.012,mats['metal'],door)
        # Forward/aft cargo doors remain low on the starboard side, distinct
        # from passenger doors. No equipment is connected to these doors.
        if side < 0:
            for label2,z in (('Forward',8.6),('Aft',-7.3)):
                outline=_ring_outline(3.06,z,1.78,1.15,.10)
                curve(f'{label2}_cargo_door_seal',_skin_outline(side,outline,.02),
                      .007,mats['joint'],cabin)
    # Six individual conformal cockpit panes. Their upper edges sweep back
    # around the nose; all panes follow the pressure-shell curvature.
    for side,label in ((1,'L'),(-1,'R')):
        # The forward upper corner stays below the local shell crown
        # (Y~4.853 at Z17.42), rather than clamping outside the radome.
        panes=[[(4.51,17.78),(4.82,17.42),(5.31,16.69),(4.77,16.92)],
               [(4.77,16.83),(5.32,16.60),(5.48,16.00),(4.88,16.12)],
               [(4.89,16.02),(5.47,15.91),(5.43,15.49),(4.95,15.50)]]
        for i,outline in enumerate(panes):
            _skin_patch(f'Cockpit_{label}_{i+1}_glazing',side,outline,mats['cockpit'],cabin,.026)
            curve(f'Cockpit_{label}_{i+1}_gasket',_skin_outline(side,outline,.029),
                  .014,mats['gasket'],cabin)
        curve(f'Cockpit_{label}_wiper',[_skin(side,4.63,17.36,.060),_skin(side,4.87,17.14,.060)],
              .012,mats['darkmetal'],cabin)


def _airfoil_value(t, thickness, camber=.012):
    # Closed trailing edge; the cosine-spaced leading-edge samples are dense.
    yt=5*thickness*(.2969*math.sqrt(max(0,t))-.126*t-.3516*t*t+.2843*t**3-.1036*t**4)
    yc=camber*math.sin(math.pi*t)
    return yc,yt


def _lifting_surface(name, side, stations, mat, parent, vertical=False):
    """stations=(span coordinate, lead Z, trailing Z, height/centre X, thickness).
    Airfoil thickness is metres, not a percentage. 48 contour samples/section.
    Vertical mode uses span=Y, centre coordinate=X.
    """
    n=24
    ts=[(1-math.cos(math.pi*j/n))/2 for j in range(n+1)]
    contour=[(t,1) for t in ts]+[(t,-1) for t in reversed(ts[1:-1])]
    verts=[]
    for span,lead,trail,height,thick in stations:
        chord=lead-trail
        for t,upper in contour:
            c,v=_airfoil_value(t,thick/chord, .012 if not vertical else 0)
            offset=(c+upper*v)*chord
            if vertical: verts.append((height+offset,span,lead-t*chord))
            else: verts.append((side*span,height+offset,lead-t*chord))
    m=len(contour)
    faces=[]
    for k in range(len(stations)-1):
        for j in range(m):
            faces.append((k*m+j,(k+1)*m+j,(k+1)*m+(j+1)%m,k*m+(j+1)%m))
    faces += [tuple(reversed(range(m))),tuple((len(stations)-1)*m+j for j in range(m))]
    obj=mesh(name,verts,faces,mat,parent,True)
    # Airfoil cap and strip winding differs on mirrored surfaces. Recalculate
    # all closed shell normals to make export independent of material sidedness.
    _normals(obj)
    return obj


def _normals(obj):
    import bmesh
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(obj.data); bm.free()


WING_STATIONS=[(1.40,3.65,-3.70,2.93,.72),(2.1,3.35,-3.92,2.98,.68),
               (4.8,1.65,-4.58,3.15,.56),(7.6,-.12,-4.96,3.38,.40),
               (11.5,-2.37,-5.55,3.71,.26),(15.3,-4.44,-6.22,4.02,.16),
               (17.15,-5.35,-6.65,4.18,.115)]


def _wing_point(side,span,t,lift=.014):
    for a,b in zip(WING_STATIONS[:-1],WING_STATIONS[1:]):
        if a[0]<=span<=b[0]:
            f=(span-a[0])/(b[0]-a[0]); _,lead,trail,y,thick=[a[i]+(b[i]-a[i])*f for i in range(5)]
            chord=lead-trail; c,v=_airfoil_value(t,thick/chord)
            return (side*span,y+(c+v)*chord+lift,lead-t*chord)
    raise ValueError(span)


def _wings(root,mats):
    for side,label in ((1,'Port'),(-1,'Starboard')):
        group=empty(f'{label}_wing_assembly',root)
        wing=_lifting_surface(f'{label}_wing_airfoil',side,WING_STATIONS,mats['wing'],group)
        # The leading 10.3% of each airfoil uses aluminium on the existing
        # shell, including its underside. No coplanar slat overlay is needed.
        wing.data.materials.append(mats['slat'])
        contour_count=48  # _lifting_surface: 25 upper + 23 lower samples.
        side_face_count=(len(WING_STATIONS)-1)*contour_count
        for polygon in wing.data.polygons:
            section_edge=polygon.index%contour_count
            if polygon.index<side_face_count and (section_edge<5 or section_edge>=43):
                polygon.material_index=1
        for t,span0,span1,name in ((.71,2.5,15.9,'Flap'),(.12,2.5,16.8,'Slat')):
            points=[_wing_point(side,span0+(span1-span0)*j/40,t) for j in range(41)]
            curve(f'{label}_{name}_seam',points,.008,mats['joint'],group)
        for i,span in enumerate([4.5,6.3,8.4,10.5,12.6,14.7]):
            curve(f'{label}_wing_panel_joint_{i}',[_wing_point(side,span,.14),_wing_point(side,span,.70)],
                  .006,mats['joint'],group)
        for i,(a,b) in enumerate([(3.1,4.3),(4.6,5.9),(6.3,7.5),(7.9,9.1),(9.5,10.7)]):
            points=[_wing_point(side,a,.48),_wing_point(side,b,.48),_wing_point(side,b,.69),
                    _wing_point(side,a,.69),_wing_point(side,a,.48)]
            curve(f'{label}_spoiler_panel_{i+1}',points,.007,mats['joint'],group)
        # Three streamlined flap-track fairings beneath each wing.
        for i,span in enumerate([4.2,7.3,10.4]):
            p=_wing_point(side,span,.75)
            _pod(f'{label}_flap_track_fairing_{i+1}',(p[0],p[1]-.24,p[2]-.65),
                 .18,.21,1.55,mats['paint'],group)
        # Curved sharklet grows from the real wing tip. Its outermost side is
        # exactly 17.90 m; the entire width remains exactly 35.80 m.
        shark=[(17.15,-5.35,-6.65,4.18,.115),(17.39,-5.52,-6.72,4.42,.11),
               (17.60,-5.77,-6.86,4.89,.10),(17.78,-6.11,-7.00,5.62,.075),
               (17.90,-6.47,-7.12,6.38,.05)]
        _lifting_surface(f'{label}_sharklet',side,shark,mats['tail'],group)
        # Thin white tip at the top of the sharklet, with no luminous effects.
        curve(f'{label}_sharklet_tip',[(side*17.892,6.38,-6.48),(side*17.892,6.38,-7.12)],
              .008,mats['paint'],group)
        # Wing navigation light tucked inward so it does not alter span.
        _pod(f'{label}_navigation_light',(side*17.05,4.25,-5.42),.025,.025,.075,
             mats['red'] if side==1 else mats['green'],group)


def _pod(name,center,rx,ry,half_length,mat,parent):
    verts=[]; faces=[]; n=24; sections=18
    for k in range(sections+1):
        a=math.pi*k/sections
        radius=max(.002,math.sin(a))
        z=center[2]+math.cos(a)*half_length
        for j in range(n):
            t=TAU*j/n
            verts.append((center[0]+rx*radius*math.cos(t),center[1]+ry*radius*math.sin(t),z))
    for k in range(sections):
        for j in range(n):
            a=k*n+j; b=k*n+(j+1)%n
            faces.append((a,a+n,b+n,b))
    obj=mesh(name,verts,faces,mat,parent,True); _normals(obj)
    return obj


def _tail(root,mats):
    group=empty('Empennage',root)
    fin=[(5.75,-9.9,-17.2,0,.56),(6.55,-11.17,-17.48,0,.51),
         (7.30,-12.14,-17.54,0,.43),(8.6,-13.28,-17.43,0,.31),
         (10.5,-14.77,-17.17,0,.21),(11.53,-15.57,-17.04,0,.14),
         (11.76,-15.82,-16.99,0,.10)]
    _lifting_surface('Vertical_stabilizer_airfoil',1,fin,mats['tail'],group,vertical=True)
    # Original geometric livery: offset pale slashes, no brand/airline emblem.
    for side in (1,-1):
        for i,(lo,hi) in enumerate([(7.15,8.45),(8.75,10.05)]):
            verts=[(side*.155,lo,-14.85),(side*.155,lo+.3,-16.35),
                   (side*.105,hi+.3,-16.52),(side*.12,hi,-15.37)]
            mesh(f'Tail_abstract_band_{side}_{i}',verts,[(0,1,2,3)] if side==1 else [(3,2,1,0)],
                 mats['tail_accent'],group)
        curve(f'Rudder_hinge_seam_{side}',[(side*.16,6.7,-16.45),(side*.12,8.6,-16.60),
              (side*.07,10.6,-16.68),(side*.035,11.6,-16.75)],.007,mats['tail_joint'],group)
    for side,label in ((1,'Port'),(-1,'Starboard')):
        stations=[(.65,-11.7,-17.2,5.15,.34),(1.9,-12.7,-17.28,5.37,.30),
                  (3.8,-14.25,-17.45,5.70,.21),(6.24,-16.10,-17.65,6.10,.10)]
        _lifting_surface(f'{label}_horizontal_stabilizer',side,stations,mats['wing'],group)
        curve(f'{label}_elevator_hinge',[(side*.9,5.22,-16.14),(side*3.8,5.76,-16.8),
              (side*6.22,6.14,-17.25)],.006,mats['joint'],group)
    # Tail cone APU opening is inset before the 37.57 m body limit.
    cylinder('APU_exhaust_liner',(0,5.24,-18.40),(0,5.24,-18.70),.085,mats['darkmetal'],group,32)


def _revolve_z(name,cx,cy,profile,mat,parent,n=64):
    # profile follows the outer/inner wall continuously; its endpoint is not
    # automatically capped. This is used for real hollow intake geometry.
    verts=[]; faces=[]
    for z,r in profile:
        verts.extend((cx+r*math.cos(j*TAU/n),cy+r*math.sin(j*TAU/n),z) for j in range(n))
    for k in range(len(profile)-1):
        for j in range(n):
            a=k*n+j; b=k*n+(j+1)%n
            faces.append((a,b,b+n,a+n))
    obj=mesh(name,verts,faces,mat,parent,True)
    return obj


def _engines(root,mats):
    for side,label in ((1,'Port'),(-1,'Starboard')):
        cx=side*5.63; cy=2.11
        engine=empty(f'{label}_LEAP1A_engine',root)
        engine['appearance_reference']='LEAP-1A, original approximate surface geometry'
        outer=[(1.23,.84),(1.50,.97),(2.05,1.16),(2.90,1.28),(3.80,1.33),
               (4.60,1.34),(5.03,1.31)]
        _revolve_z(f'{label}_nacelle_outer_cowling',cx,cy,outer,mats['paint'],engine)
        # Complete rounded inlet lip joins the cowling to the inner duct.
        lip=[(5.03,1.31),(5.30,1.25),(5.48,1.17),(5.52,1.12),
             (5.48,1.075),(5.37,1.045),(5.12,1.032),(4.94,1.03)]
        _revolve_z(f'{label}_polished_intake_lip',cx,cy,lip,mats['intake'],engine)
        _revolve_z(f'{label}_inner_acoustic_duct',cx,cy,[(4.94,1.03),(4.70,1.01),(4.47,.99)],
                   mats['duct'],engine)
        # Separate panel rings and longitudinal seams retain engine detail.
        for i,z in enumerate([2.15,3.13,4.82]):
            r=1.34 if z>3 else 1.18
            if z==3.13: r=1.30
            curve(f'{label}_engine_cowl_ring_{i}',[(cx+r*math.cos(j*TAU/64),cy+r*math.sin(j*TAU/64),z)
                  for j in range(65)],.005,mats['joint'],engine)
        for angle in [.5,2.6,4.7]:
            curve(f'{label}_engine_longitudinal_joint_{angle}',
                  [(cx+(r+.005)*math.cos(angle),cy+(r+.005)*math.sin(angle),z) for z,r in outer[2:-1]],
                  .005,mats['joint'],engine)
        fan=empty(f'{label}_engine_fan_pivot',engine)
        fan['rotation_axis_browser']='Z'; fan['pivot_browser']=[cx,cy,4.50]
        # An actual 18-blade swept fan, with inner/outer shape and twist. The
        # hub does not cover a black disc: the inlet is open down to the blades.
        for blade in range(18):
            angle=TAU*blade/18
            vs=[]
            for r,sweep,width in [(.25,-.10,.21),(.42,-.015,.20),(.67,.12,.15),(.96,.22,.095)]:
                for edge in (-1,1):
                    a=angle+sweep+edge*width
                    vs.append((cx+r*math.cos(a),cy+r*math.sin(a),4.50+edge*.085+(r-.25)*.05))
            fs=[(2,3,1,0),(4,5,3,2),(6,7,5,4)]
            mesh(f'{label}_fan_blade_{blade+1:02d}',vs,fs,mats['fan'],fan,True)
            curve(f'{label}_fan_blade_edge_{blade+1:02d}',[vs[1],vs[3],vs[5],vs[7]],
                  .006,mats['fan_edge'],fan)
        # A dark rear annulus makes the gaps read as depth, not open daylight.
        _revolve_z(f'{label}_fan_rear_annulus',cx,cy,[(4.37,1.01),(4.37,.23)],mats['duct'],fan)
        _revolve_z(f'{label}_fan_spinner',cx,cy,[(4.42,.28),(4.62,.26),(4.86,.19),
                   (5.05,.085),(5.10,.002)],mats['spinner'],fan,48)
        spiral=[]
        for j in range(70):
            a=j*math.pi*3/69; r=.012+.15*j/69
            spiral.append((cx+r*math.cos(a),cy+r*math.sin(a),5.105-.22*(r/.17)))
        curve(f'{label}_spinner_white_spiral',spiral,.012,mats['paint'],fan)
        _revolve_z(f'{label}_exhaust_fairing',cx,cy,[(.65,.61),(.75,.69),(.98,.79),(1.30,.84)],
                   mats['exhaust'],engine)
        _revolve_z(f'{label}_exhaust_inner',cx,cy,[(1.10,.52),(.68,.52),(.65,.61)],mats['duct'],engine)
        _revolve_z(f'{label}_core_exhaust_cone',cx,cy,[(.24,.002),(.32,.08),(.65,.30),(1.3,.40)],
                   mats['darkmetal'],engine,40)
        # Pylon is a tapered fairing occupying the gap between nacelle and wing.
        pylon=[(cx-.21,3.05,1.25),(cx+.21,3.05,1.25),(cx-.22,3.16,4.0),
               (cx+.22,3.16,4.0),(cx-.15,3.58,.9),(cx+.15,3.58,.9),
               (cx-.15,3.59,2.4),(cx+.15,3.59,2.4)]
        obj=mesh(f'{label}_engine_pylon',pylon,[(0,1,3,2),(4,6,7,5),(0,4,5,1),
                 (2,3,7,6),(0,2,6,4),(1,5,7,3)],mats['wing'],engine,True);_normals(obj)


def _wheel(name,center,radius,width,parent,mats):
    group=empty(name,parent)
    group['axle_axis_browser']='X';group['pivot_browser']=list(center)
    cx,cy,cz=center; n=40
    profile=[(-width*.5,radius*.49),(-width*.54,radius*.64),(-width*.48,radius*.85),
             (-width*.34,radius*.98),(-width*.20,radius),(width*.20,radius),
             (width*.34,radius*.98),(width*.48,radius*.85),(width*.54,radius*.64),
             (width*.5,radius*.49)]
    vs=[];fs=[]
    for x,r in profile:
        vs.extend((cx+x,cy+r*math.cos(j*TAU/n),cz+r*math.sin(j*TAU/n)) for j in range(n))
    for k in range(len(profile)-1):
        for j in range(n):
            a=k*n+j;b=k*n+(j+1)%n;fs.append((a,b,b+n,a+n))
    obj=mesh(name+'_rubber_tire',vs,fs,mats['rubber'],group,True);_normals(obj)
    cylinder(name+'_alloy_hub',(cx-width*.51,cy,cz),(cx+width*.51,cy,cz),radius*.49,mats['metal'],group,32)
    for side in (-1,1):
        hx=cx+side*width*.535
        cylinder(name+f'_axle_cap_{side}',(hx,cy,cz),(hx+side*.012,cy,cz),radius*.21,mats['darkmetal'],group,24)
        for j in range(6):
            a=TAU*j/6
            yy=cy+radius*.34*math.cos(a);zz=cz+radius*.34*math.sin(a)
            cylinder(name+f'_hub_bolt_{side}_{j}',(hx,yy,zz),(hx+side*.009,yy,zz),radius*.036,mats['darkmetal'],group,8)
    # Tire tread grooves are slightly inset black lines on the tread crown.
    for i,offset in enumerate([-.12*width,.12*width]):
        curve(name+f'_tread_groove_{i}',[(cx+offset,cy+(radius-.007)*math.cos(j*TAU/n),
              cz+(radius-.007)*math.sin(j*TAU/n)) for j in range(n+1)],.006,mats['tread'],group)
    return group


def _gear(root,mats):
    nose=empty('Nose_landing_gear',root)
    nose['pivot_browser']=[0,2.7,12.85]
    # Wheel radii exactly equal wheel centre height: contact at y=0.
    for side in (-1,1):_wheel(f'Nose_wheel_{side}',(side*.235,.39,13.05),.39,.22,nose,mats)
    cylinder('Nose_oleo_lower',(0,.40,13.05),(0,1.35,13.08),.105,mats['metal'],nose)
    cylinder('Nose_oleo_upper',(0,1.30,13.08),(0,2.65,12.83),.14,mats['gearpaint'],nose)
    cylinder('Nose_axle',(-.44,.39,13.05),(.44,.39,13.05),.09,mats['metal'],nose)
    cylinder('Nose_drag_brace',(0,.95,13.02),(0,2.43,11.84),.07,mats['gearpaint'],nose)
    cylinder('Nose_torque_link_A',(0,1.20,13.23),(0,1.04,13.45),.045,mats['metal'],nose)
    cylinder('Nose_torque_link_B',(0,1.04,13.45),(0,.80,13.20),.045,mats['metal'],nose)
    for side in (-1,1):
        box(f'Nose_gear_door_{side}',(side*.28,2.02,12.60),(.045,.82,1.1),mats['paint'],nose,.025)
        box(f'Nose_landing_light_{side}',(side*.20,1.28,13.30),(.13,.13,.055),mats['light'],nose,.025)
    for side,label in ((1,'Port'),(-1,'Starboard')):
        gear=empty(f'{label}_main_landing_gear',root)
        gear['pivot_browser']=[side*2.45,2.75,-1.2]
        cx=side*3.42;z=-2.20
        for j,dx in enumerate([-.29,.29]):
            _wheel(f'{label}_main_wheel_{j+1}',(cx+dx,.58,z),.58,.37,gear,mats)
        cylinder(f'{label}_main_axle',(cx-.60,.58,z),(cx+.60,.58,z),.12,mats['metal'],gear)
        cylinder(f'{label}_main_oleo_lower',(cx,.63,z),(cx,1.50,z+.12),.14,mats['metal'],gear)
        cylinder(f'{label}_main_oleo_upper',(cx,1.42,z+.12),(cx,2.90,z+.39),.20,mats['gearpaint'],gear)
        cylinder(f'{label}_main_side_brace',(cx,1.1,z+.1),(side*1.8,2.65,z+.75),.075,mats['metal'],gear)
        cylinder(f'{label}_main_drag_brace',(cx,1.20,z),(cx,2.78,z+1.25),.08,mats['gearpaint'],gear)
        cylinder(f'{label}_main_torque_link_A',(cx,1.38,z-.18),(cx,1.15,z-.38),.055,mats['metal'],gear)
        cylinder(f'{label}_main_torque_link_B',(cx,1.15,z-.38),(cx,.90,z-.16),.055,mats['metal'],gear)
        box(f'{label}_main_gear_door',(cx+side*.23,1.91,z+.2),(.07,1.45,.83),mats['paint'],gear,.055)
        curve(f'{label}_hydraulic_line',[(cx+.17,2.7,z+.3),(cx+.18,1.7,z+.2),(cx+.2,.95,z)],
              .019,mats['rubber'],gear)


def _details(root,mats):
    details=empty('Aircraft_external_details',root)
    for i,z in enumerate([7.3,-5.9]):
        mesh(f'Dorsal_VHF_antenna_{i}',[(-.035,6.19,z+.20),(.035,6.19,z+.20),
             (-.035,6.19,z-.26),(.035,6.19,z-.26),(-.012,6.51,z-.11),(.012,6.51,z-.11)],
             [(0,2,4),(1,5,3),(0,1,3,2),(0,4,5,1),(2,3,5,4)],mats['paint'],details)
    _pod('Dorsal_anti_collision_beacon',(0,6.225,2.8),.11,.065,.14,mats['red'],details)
    _pod('Belly_anti_collision_beacon',(0,2.07,.8),.10,.055,.13,mats['red'],details)
    for side in (-1,1):
        # Thin pitot probes and static ports; no emissive decorative surfaces.
        p=_skin(side,3.96,16.3,.04)
        cylinder(f'Pitot_probe_{side}',p,(p[0]+side*.12,p[1],p[2]+.40),.018,mats['metal'],details,12)
        outline=_ring_outline(3.52,16.2,.19,.23,.04)
        _skin_patch(f'Static_port_panel_{side}',side,outline,mats['door'],details,.018)
        curve(f'Static_port_outline_{side}',[_skin(side,y,z,.022) for y,z in outline+[outline[0]]],
              .005,mats['joint'],details)


def _merge_matching(objects, name):
    """Join only explicitly selected newly generated objects, never user data."""
    objects=list(objects)
    if len(objects)<2:return
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    objects[0].name=name


def _batch_static_details(root):
    # Each wheel, fan and door retains its independent parent/pivot. Repeated
    # static glazing and trim is joined by material to avoid hundreds of calls.
    cabin=bpy.data.objects.get('Cabin_windows_and_doors')
    for side in ('L','R'):
        for suffix in ('frame','glass'):
            _merge_matching([o for o in cabin.children if o.type=='MESH' and
                             o.name.startswith(side+'_cabin_window_') and o.name.endswith('_'+suffix)],
                            f'{side}_cabin_windows_{suffix}_batched')
        _merge_matching([o for o in cabin.children if o.type=='CURVE' and
                         o.name.startswith(side+'_window_')],f'{side}_cabin_window_reflections_batched')
    for label in ('Port','Starboard'):
        fan=bpy.data.objects.get(label+'_engine_fan_pivot')
        for typ,word in [('MESH','blade_'),('CURVE','blade_edge_')]:
            _merge_matching([o for o in fan.children if o.type==typ and label+'_fan_'+word in o.name],
                            label+'_fan_'+word+'batched')
        wing=bpy.data.objects.get(label+'_wing_assembly')
        _merge_matching([o for o in wing.children if o.type=='CURVE' and
                         o.data.materials[0].name=='AT_Aircraft_Panel_Joint'],label+'_wing_panel_seams')
        engine=bpy.data.objects.get(label+'_LEAP1A_engine')
        _merge_matching([o for o in engine.children if o.type=='CURVE'],label+'_engine_cowling_seams')
    for wheel in [o for o in root.children_recursive if 'axle_axis_browser' in o]:
        for mat_name in ['AT_Aircraft_Dark_Metal','AT_Aircraft_Satin_Metal']:
            _merge_matching([o for o in wheel.children if o.type=='MESH' and o.data.materials[0].name==mat_name],
                            wheel.name+'_'+mat_name.replace('AT_Aircraft_',''))
        _merge_matching([o for o in wheel.children if o.type=='CURVE'],wheel.name+'_tread_details')
    for name in ['Nose_landing_gear','Port_main_landing_gear','Starboard_main_landing_gear']:
        gear=bpy.data.objects.get(name)
        for mat_name in ['AT_Aircraft_Satin_Metal','AT_Aircraft_Gear_Enamel']:
            _merge_matching([o for o in gear.children if o.type=='MESH' and o.data.materials[0].name==mat_name],
                            gear.name+'_'+mat_name.replace('AT_Aircraft_',''))


def build_aircraft():
    root=empty('Aircraft_A320neo_root')
    root['asset_version']='0.1';root['units']='metres'
    root['browser_axes']='+X port; +Y up; +Z nose'
    root['nominal_dimensions_m']=[37.57,35.80,11.76]
    root['L1_sill_browser']=[2.02,3.40,13.50]
    mats={
        'paint':material('Aircraft_Pearl_White',(.78,.81,.83),.10,.30),
        'belly':material('Aircraft_Belly_Pearl',(.65,.70,.74),.14,.36),
        'door':material('Aircraft_Door_White',(.75,.78,.80),.12,.34),
        'wing':material('Aircraft_Wing_Light_Gray',(.62,.68,.73),.28,.34),
        'slat':material('Aircraft_Slat_Aluminium',(.53,.60,.66),.60,.29),
        'tail':material('Aircraft_Tail_Slate_Blue',(.115,.22,.31),.24,.32),
        'tail_accent':material('Aircraft_Tail_Accent',(.33,.51,.62),.22,.34),
        'tail_joint':material('Aircraft_Tail_Seams',(.065,.11,.16),.15,.42),
        'glass':material('Aircraft_Cabin_Glass',(.055,.11,.15),.30,.19),
        'cockpit':material('Aircraft_Cockpit_Glass',(.035,.09,.13),.42,.17),
        'gasket':material('Aircraft_Cockpit_Gasket',(.045,.055,.065),.05,.64),
        'glass_highlight':material('Aircraft_Glass_Reflection',(.21,.33,.40),.35,.22),
        'frame':material('Aircraft_Window_Frame',(.36,.42,.45),.45,.34),
        'joint':material('Aircraft_Panel_Joint',(.33,.39,.43),.18,.48),
        'metal':material('Aircraft_Satin_Metal',(.48,.54,.59),.74,.26),
        'intake':material('Engine_Intake_Aluminium',(.55,.61,.65),.70,.31),
        'duct':material('Engine_Acoustic_Liner',(.11,.14,.16),.30,.61),
        'fan':material('Engine_Fan_Titanium',(.20,.24,.27),.69,.34),
        'fan_edge':material('Engine_Fan_Edges',(.39,.44,.47),.75,.27),
        'spinner':material('Engine_Spinner',(.17,.21,.24),.55,.29),
        'exhaust':material('Engine_Exhaust_Alloy',(.31,.30,.28),.72,.42),
        'darkmetal':material('Aircraft_Dark_Metal',(.12,.16,.19),.68,.38),
        'rubber':material('Aircraft_Tire_Rubber',(.026,.032,.038),.02,.84),
        'tread':material('Aircraft_Tire_Grooves',(.012,.016,.02),0,.90),
        'gearpaint':material('Aircraft_Gear_Enamel',(.53,.60,.64),.34,.34),
        'red':material('Aircraft_Red_Detail',(.57,.065,.045),.1,.33),
        'green':material('Aircraft_Green_Detail',(.035,.36,.19),.1,.33),
        'light':material('Aircraft_Lamp_Glass',(.72,.82,.88),.3,.16),
    }
    _body(root,mats);_cabin(root,mats);_wings(root,mats)
    _tail(root,mats);_engines(root,mats);_gear(root,mats);_details(root,mats)
    _batch_static_details(root)
    # Rebase animation pivots from an immutable snapshot, parent before child.
    # Incremental snapshots can read stale descendant matrices after an earlier
    # parent move and silently add a gear-parent translation twice to a wheel.
    bpy.context.view_layer.update()
    original_world={obj:obj.matrix_world.copy() for obj in root.children_recursive}
    def rebase_children(parent):
        for obj in parent.children:
            target=original_world[obj].copy()
            if 'pivot_browser' in obj:
                target.translation=coord(obj['pivot_browser'])
            obj.matrix_world=target
            if obj.children:
                bpy.context.view_layer.update()
                rebase_children(obj)
    rebase_children(root)
    bpy.context.view_layer.update()
    # All authored geometry must stay fixed when a semantic origin changes.
    for obj,before in original_world.items():
        if obj.type in {'MESH','CURVE'}:
            error=max(abs(obj.matrix_world[r][c]-before[r][c]) for r in range(4) for c in range(4))
            if error>1e-4:
                raise RuntimeError(f'Pivot rebase moved geometry: {obj.name}, matrix delta {error}')
    # Reference points for the scene controller. These are not door hinges
    # and are not children of the door's animation pivot.
    for name,point in (
        ('Aircraft_L1_anchor',(1.980802,4.325,13.5)),
        ('Aircraft_forward_cargo_anchor',(-1.675218,3.06,8.6)),
    ):
        anchor=empty(name,root,position=point)
        anchor['nodeRole']='aircraft_service_reference'
        anchor['browserPosition_m']=list(point)
    return root
