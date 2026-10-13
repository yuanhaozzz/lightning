import re, sys, zlib

path = sys.argv[1]
outpath = sys.argv[2]
data = open(path, 'rb').read()

objs = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', data):
    objs[int(m.group(1))] = m.start()

def get_body(num):
    s = objs.get(num)
    if s is None: return None
    e = data.find(b'endobj', s)
    return data[s:e if e > 0 else len(data)]

def get_stream(num):
    b = get_body(num)
    if b is None: return None
    si = b.find(b'stream')
    if si < 0: return None
    h = b[:si]; s = si + 6
    while s < len(b) and b[s] in (13, 10): s += 1
    e = b.rfind(b'endstream')
    raw = b[s:e if e > 0 else len(b)]
    if b'FlateDecode' in h:
        try: raw = zlib.decompress(raw)
        except Exception: return None
    return raw

def parse_cmap(text):
    cmap = {}
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', text, re.S):
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            src = int(m.group(1), 16); d = m.group(2).decode()
            cmap[src] = ''.join(chr(int(d[i:i+4], 16)) for i in range(0, len(d), 4))
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', text, re.S):
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            lo = int(m.group(1), 16); hi = int(m.group(2), 16); base = int(m.group(3), 16)
            for i in range(min(hi - lo + 1, 65536)):
                cmap[lo + i] = chr(base + i)
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]', blk, re.S):
            lo = int(m.group(1), 16)
            for i, h in enumerate(re.findall(rb'<([0-9A-Fa-f]+)>', m.group(3))):
                d = h.decode()
                cmap[lo + i] = ''.join(chr(int(d[j:j+4], 16)) for j in range(0, len(d), 4))
    return cmap

font_cmaps = {}
for num in list(objs):
    b = get_body(num)
    if b is None or b'/ToUnicode' not in b: continue
    m = re.search(rb'/ToUnicode\s+(\d+)\s+\d+\s+R', b)
    if m:
        s = get_stream(int(m.group(1)))
        if s: font_cmaps[num] = parse_cmap(s)

name_to_cmap = {}
for num in list(objs):
    b = get_body(num)
    if b is None: continue
    if b'/Font' not in b and b'/BaseFont' not in b: continue
    for m in re.finditer(rb'/([A-Za-z][A-Za-z0-9]*)\s+(\d+)\s+\d+\s+R', b):
        ref = int(m.group(2))
        if ref in font_cmaps:
            name_to_cmap.setdefault(m.group(1).decode(), font_cmaps[ref])

# also allow Tf names seen in content streams that match resource dict
def mat_mul(m1, m2):
    a1,b1,c1,d1,e1,f1 = m1
    a2,b2,c2,d2,e2,f2 = m2
    return (a1*a2 + b1*c2, a1*b2 + b1*d2,
            c1*a2 + d1*c2, c1*b2 + d1*d2,
            e1*a2 + f1*c2 + e2, e1*b2 + f1*d2 + f2)

def apply(m, x, y):
    a,b,c,d,e,f = m
    return (a*x + c*y + e, b*x + d*y + f)

def unescape_lit(s):
    res = []; i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i+1]
            if n in '()\\': res.append(n); i += 2; continue
            if n == 'n': res.append('\n'); i += 2; continue
            if n == 'r': res.append('\r'); i += 2; continue
            if n == 't': res.append('\t'); i += 2; continue
            if n in '01234567':
                j = i + 1; o = ''
                while j < len(s) and len(o) < 3 and s[j] in '01234567':
                    o += s[j]; j += 1
                if o: res.append(chr(int(o, 8)))
                i = j; continue
            i += 2; continue
        res.append(c); i += 1
    return ''.join(res)

tok = re.compile(r"""
   (?P<num>-?\d*\.?\d+)
 | (?P<hex><[0-9A-Fa-f\s]*>)
 | (?P<lit>\((?:\\.|[^\\()])*\))
 | (?P<name>/[^\s/\[\]<>()]+)
 | (?P<arr>\[|\])
 | (?P<op>[A-Za-z'"*]+)
""", re.X | re.S)

runs = []   # (x, y, text)
seen_fonts = set()
for num in sorted(objs):
    st = get_stream(num)
    if not st or b'BT' not in st: continue
    text = st.decode('latin-1')
    if 'Tj' not in text and 'TJ' not in text: continue
    ctm = (1, 0, 0, 1, 0, 0)
    stack = []
    tm = (1, 0, 0, 1, 0, 0)
    tlm = (1, 0, 0, 1, 0, 0)
    leading = 0.0
    cur = None
    cur_name = None
    nums = []
    pending_show = []
    pending_name = None
    for m in tok.finditer(text):
        if m.lastgroup == 'num':
            nums.append(float(m.group('num'))); continue
        if m.lastgroup == 'name':
            pending_name = m.group('name')[1:]
            continue
        if m.lastgroup == 'hex':
            hexs = re.sub(r'\s+', '', m.group('hex')[1:-1])
            if len(hexs) % 2: hexs = hexs[:-1]
            codes2 = [int(hexs[i:i+4], 16) for i in range(0, len(hexs)-3, 4)]
            cm = cur or {}
            s2 = ''.join(cm.get(c, '') for c in codes2)
            codes1 = [int(hexs[i:i+2], 16) for i in range(0, len(hexs), 2)]
            s1 = ''.join(cm.get(c, '') for c in codes1)
            pending_show.append(s2 if len(s2) >= len(s1) else s1)
            nums = []
            continue
        if m.lastgroup == 'lit':
            raw = unescape_lit(m.group('lit')[1:-1])
            cm = cur
            pending_show.append(''.join(cm.get(ord(ch), ch) for ch in raw) if cm else raw)
            nums = []
            continue
        if m.lastgroup == 'arr':
            continue
        op = m.group('op')
        if op == 'q':
            stack.append(ctm)
        elif op == 'Q':
            if stack: ctm = stack.pop()
        elif op == 'cm' and len(nums) >= 6:
            ctm = mat_mul(tuple(nums[-6:]), ctm)
        elif op == 'BT':
            tm = tlm = (1, 0, 0, 1, 0, 0)
        elif op == 'Tf':
            if pending_name:
                cur = name_to_cmap.get(pending_name)
                cur_name = pending_name
                seen_fonts.add(pending_name)
        elif op == 'Tm' and len(nums) >= 6:
            tlm = tuple(nums[-6:])
            tm = tlm
        elif op in ('Td', 'TD') and len(nums) >= 2:
            if op == 'TD': leading = -nums[-1]
            tlm = mat_mul((1, 0, 0, 1, nums[-2], nums[-1]), tlm)
            tm = tlm
        elif op == 'TL' and nums:
            leading = nums[-1]
        elif op == 'T*':
            tlm = mat_mul((1, 0, 0, 1, 0, -leading), tlm)
            tm = tlm
        elif op in ('Tj', 'TJ', "'", '"'):
            s = ''.join(pending_show)
            if s:
                x, y = apply(mat_mul(ctm, tm), 0, 0)
                runs.append((round(x, 2), round(y, 2), s, cur_name))
            pending_show = []
            if op in ("'", '"'):
                tlm = mat_mul((1, 0, 0, 1, 0, -leading), tlm)
                tm = tlm
        nums = []

# also capture Tf font names per run? keep simple: track separately
sys.stderr.write("runs=%d usedFonts=%s cmapFonts=%s\n" % (len(runs), sorted(seen_fonts), sorted(name_to_cmap)))
# group into lines by y
runs.sort(key=lambda r: (r[1], r[0]))
lines = []
for x, y, s, fn in runs:
    if lines and abs(lines[-1][0] - y) < 37:   # 0.06 scale => ~2.2pt
        lines[-1][1].append((x, s, fn))
    else:
        lines.append((y, [(x, s, fn)]))
out = []
for y, items in lines:
    items.sort()
    out.append("%8.1f | %s" % (y, ''.join(t for _, t, _ in items)))
open(outpath, 'w', encoding='utf-8').write('\n'.join(out))
sys.stderr.write("lines=%d\n" % len(out))
