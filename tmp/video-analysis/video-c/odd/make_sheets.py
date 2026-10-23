from PIL import Image, ImageDraw
from pathlib import Path
p=Path(r'F:\code\lightning\tmp\video-analysis\video-c\odd')
files=sorted(p.glob('frame_*.jpg'))
for start in range(0,len(files),20):
    out=Image.new('RGB',(1440,1200),'#222222')
    d=ImageDraw.Draw(out)
    for j,f in enumerate(files[start:start+20]):
        im=Image.open(f).crop((0,835,720,925))
        x=(j%2)*720;y=(j//2)*120
        out.paste(im,(x,y+22))
        d.text((x+8,y+4),f'{(start+j)*2+1:03d}s',fill='white')
    out.save(p/f'sheet_{start//20+1:02d}.jpg')
