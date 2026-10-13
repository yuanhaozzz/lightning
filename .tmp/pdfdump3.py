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

# inspect resources 11 0 R for fonts
print("RESOURCES:", get_body(11)[:800] if get_body(11) else None)
print("---- font objs")
for num in sorted(objs):
    b = get_body(num)
    if b and b'/Type' in b and b'/Font' in b:
        print(num, b[:300])

print("==== CM sequence in stream 9 (first 60) ====")
st = get_stream(9).decode('latin-1')
for m in list(re.finditer(r'([\d.\- ]+)\s+cm|q\b|Q\b|BT|ET|([\d.\-]+)\s+([\d.\-]+)\s+Td', st))[:80]:
    print(repr(m.group(0)))
