import re, sys, zlib
path = sys.argv[1]
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
    while s < len(b) and b[s] in (13,10): s += 1
    e = b.rfind(b'endstream')
    raw = b[s:e if e > 0 else len(b)]
    if b'FlateDecode' in h:
        try: raw = zlib.decompress(raw)
        except Exception: return None
    return raw

# page content streams
for num in sorted(objs):
    b = get_body(num)
    if b is None: continue
    if b'/Type' in b and b'/Page' in b and b'/Contents' in b:
        print("PAGE obj", num, b[:400])
        break
streams = []
for num in sorted(objs):
    st = get_stream(num)
    if st and (b'Tj' in st or b'TJ' in st):
        streams.append((num, st))
print("content streams:", [n for n,_ in streams])
for n, st in streams[:1]:
    print("----- stream", n, "len", len(st))
    print(st[:3000].decode('latin-1'))
