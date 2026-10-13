import re, sys, zlib

data = open(sys.argv[1], 'rb').read()
print("size", len(data))

# Collect all stream objects
objs = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', data):
    num = int(m.group(1))
    objs[num] = m.start()

def get_obj_body(num):
    start = objs.get(num)
    if start is None:
        return None
    end = data.find(b'endobj', start)
    return data[start:end if end > 0 else len(data)]

def get_stream(num):
    body = get_obj_body(num)
    if body is None:
        return None
    si = body.find(b'stream')
    if si < 0:
        return None
    header = body[:si]
    s = si + 6
    while s < len(body) and body[s] in (13, 10):
        s += 1
    ei = body.rfind(b'endstream')
    raw = body[s:ei if ei > 0 else len(body)]
    if b'FlateDecode' in header:
        try:
            raw = zlib.decompress(raw)
        except Exception as e:
            try:
                raw = zlib.decompressobj().decompress(raw)
            except Exception as e2:
                return None
    return raw

# Find ToUnicode CMaps: parse "beginbfchar"/"beginbfrange"
def parse_cmap(text):
    cmap = {}
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', text, re.S):
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            src = int(m.group(1), 16)
            dsthex = m.group(2).decode()
            dst = ''.join(chr(int(dsthex[i:i+4], 16)) for i in range(0, len(dsthex), 4))
            cmap[src] = dst
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', text, re.S):
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            lo = int(m.group(1), 16); hi = int(m.group(2), 16)
            dsthex = m.group(3).decode()
            base = int(dsthex, 16)
            for i in range(hi - lo + 1):
                cmap[lo + i] = chr(base + i)
        for m in re.finditer(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]', blk, re.S):
            lo = int(m.group(1), 16)
            arr = re.findall(rb'<([0-9A-Fa-f]+)>', m.group(3))
            for i, h in enumerate(arr):
                cmap[lo + i] = ''.join(chr(int(h.decode()[j:j+4], 16)) for j in range(0, len(h.decode()), 4))
    return cmap

# Map font resource names -> cmap by scanning /Font << /F1 5 0 R >> dicts
font_cmaps = {}
for num in list(objs):
    body = get_obj_body(num)
    if body is None: continue
    if b'/ToUnicode' in body:
        m = re.search(rb'/ToUnicode\s+(\d+)\s+\d+\s+R', body)
        if m:
            s = get_stream(int(m.group(1)))
            if s:
                font_cmaps[num] = parse_cmap(s)

# resource name -> font obj num
name_to_cmap = {}
for num in list(objs):
    body = get_obj_body(num)
    if body is None: continue
    for m in re.finditer(rb'/(F\w+|[A-Za-z]+\d+)\s+(\d+)\s+\d+\s+R', body):
        name = m.group(1).decode()
        ref = int(m.group(2))
        if ref in font_cmaps:
            name_to_cmap.setdefault(name, font_cmaps[ref])

print("fonts with cmap:", len(font_cmaps), "resource names:", sorted(name_to_cmap)[:40])

out = []
for num in sorted(objs):
    st = get_stream(num)
    if not st: continue
    if b'BT' not in st or (b'Tj' not in st and b'TJ' not in st):
        continue
    cur = None
    text = st.decode('latin-1')
    for m in re.finditer(r'/([A-Za-z0-9]+)\s+[\d.]+\s+Tf|\[(.*?)\]\s*TJ|\((.*?)\)\s*Tj|(T\*|Td|TD|ET)', text, re.S):
        if m.group(1):
            cur = name_to_cmap.get(m.group(1))
        elif m.group(2) is not None:
            s = ''
            for h in re.findall(r'<([0-9A-Fa-f]+)>|\((.*?)(?<!\\)\)', m.group(2), re.S):
                if h[0]:
                    hx = h[0]
                    for i in range(0, len(hx), 4):
                        code = int(hx[i:i+4], 16)
                        s += cur.get(code, '') if cur else chr(code)
                elif h[1] is not None:
                    raw = h[1]
                    for ch in raw:
                        s += ch if cur is None else cur.get(ord(ch), ch)
            out.append(s)
        elif m.group(3) is not None:
            raw = m.group(3)
            s = ''
            for ch in raw:
                s += ch if cur is None else cur.get(ord(ch), ch)
            out.append(s)
        elif m.group(4) in ('T*', 'Td', 'TD', 'ET'):
            out.append('\n')
    out.append('\n===PAGE===\n')

print(''.join(out))
