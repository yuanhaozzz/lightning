import sys
from pypdf import PdfReader

path = sys.argv[1]
out = sys.argv[2]
reader = PdfReader(path)
print("pages:", len(reader.pages))
parts = []
for i, page in enumerate(reader.pages):
    txt = page.extract_text() or ""
    parts.append("========== PAGE %d ==========\n%s" % (i + 1, txt))
data = "\n".join(parts)
open(out, "w", encoding="utf-8").write(data)
print("chars:", len(data))
print(data[:4000])
