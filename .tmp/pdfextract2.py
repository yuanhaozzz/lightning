import re, sys, zlib

path = sys.argv[1]
outpath = sys.argv[2]
data = open(path, 'rb').read()

objs = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', data):
    objs[int(m.group(1))] = m.start()

def get_obj_body(num):
    start = objs.get(num)
    if start is None: return None
    end = data.find(b'endobj', start)
    return data[start:end if end > 0 else len(data)]

def get_stream(num):
    body = get_obj_body(num)
    if body is None: return None
    si = body.find(b'stream')
    if si < 0: return None
    header = body[:si]
    s = si + 6
    while s < len(body) and body[s] in (13, 10): s += 1
    ei = body.rfind(b'endstream')
    raw = body[s:ei if ei > 0 else len(body)]
    if b'FlateDecode' in header:
        try: raw = zlib.decompress(raw)
        except Exception:
            try: raw = zlib.decompressobj().decompress(raw)
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
    body = get_obj_body(num)
    if body is None or b'/ToUnicode' not in body: continue
    m = re.search(rb'/ToUnicode\s+(\d+)\s+\d+\s+R', body)
    if m:
        s = get_stream(int(m.group(1)))
        if s: font_cmaps[num] = parse_cmap(s)

# map resource names to cmaps by scanning font dicts
name_to_cmap = {}
for num in list(objs):
    body = get_obj_body(num)
    if body is None: continue
    if b'/Font' not in body and b'/BaseFont' not in body: continue
    for m in re.finditer(rb'/([A-Za-z][A-Za-z0-9]*)\s+(\d+)\s+\d+\s+R', body):
        ref = int(m.group(2))
        if ref in font_cmaps:
            name_to_cmap.setdefault(m.group(1).decode(), font_cmaps[ref])

sys.stderr.write("cmaps=%d names=%s\n" % (len(font_cmaps), sorted(name_to_cmap)))

def unescape_lit(s):
    res = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i+1]
            if n in '()\\': res.append(n); i += 2; continue
            if n == 'n': res.append('\n'); i += 2; continue
            if n == 'r': res.append('\r'); i += 2; continue
            if n == 't': res.append('\t'); i += 2; continue
            if n in '01234567':
                j = i + 1; oct_s = ''
                while j < len(s) and len(oct_s) < 3 and s[j] in '01234567':
                    oct_s += s[j]; j += 1
                if oct_s:
                    res.append(chr(int(oct_s, 8)))
                i = j; continue
            i += 2; continue
        res.append(c); i += 1
    return ''.join(res)

def decode_with(cmap, raw_bytes_codes):
    out = ''
    for code in raw_bytes_codes:
        out += cmap.get(code) or ''
    return out

token_re = re.compile(r'/([A-Za-z0-9#_.+-]+)\s+([\d.]+)\s+Tf|<([0-9A-Fa-f\s]*)>|\(((?:[^()\\]|\\.|\([^()]*\))*)\)|\b(TJ|Tj|T\*|Td|TD|TL|ET)\b', re.S)

out_lines = []
for num in sorted(objs):
    st = get_stream(num)
    if not st: continue
    if b'BT' not in st: continue
    text = st.decode('latin-1')
    if 'Tj' not in text and 'TJ' not in text:
        continue
    cur = None
    pending = None
    rendered = []
    for m in token_re.finditer(text):
        if m.group(1):
            cur = name_to_cmap.get(m.group(1))
            continue
        if m.group(3) is not None:
            hexs = re.sub(r'\s+', '', m.group(3))
            if len(hexs) % 2:
                hexs = hexs[:-1]
            bytevals = [int(hexs[i:i+2], 16) for i in range(0, len(hexs), 2)]
            # try 2-byte codes first
            codes2 = [int(hexs[i:i+4], 16) for i in range(0, len(hexs) - 3, 4)]
            cand2 = decode_with(cur or {}, codes2)
            cand1 = decode_with(cur or {}, bytevals)
            pending = cand2 if len(cand2) >= len(cand1) else cand1
            continue
        if m.group(4) is not None:
            raw = unescape_lit(m.group(4))
            codes = [ord(c) for c in raw]
            pending = decode_with(cur or {}, codes) if cur else raw
            continue
        op = m.group(5)
        if op in ('Tj', 'TJ'):
            if pending is not None:
                rendered.append(pending)
            pending = None
        elif op in ('T*', 'Td', 'TD'):
            rendered.append('\n')
    s = ''.join(rendered)
    if s.strip():
        out_lines.append(s)

open(outpath, 'w', encoding='utf-8').write('\n===STREAM===\n'.join(out_lines))
sys.stderr.write("wrote %s, streams=%d\n" % (outpath, len(out_lines)))
