"""Reuse the actual existing rope path; no other model generation/export."""
import sys, json, shutil
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/blender'))
import generate_core_production as p
cfg=json.loads((ROOT/'scripts/blender/core_production.parameters.json').read_text(encoding='utf8'))
p.materials();p.reset();p.ROPE_POINTS.clear();p.rope_geometry(cfg)
work=ROOT/'tmp/headframe-rope-check'
(work/'public/models').mkdir(parents=True,exist_ok=True)
shutil.copyfile(ROOT/'tmp/mine-headframe-stage1.glb',work/'public/models/mine-headframe.glb')
p.ROOT=work
result=p.check_existing_headframe(cfg)
assert result['ropeStationaryMinimumClearance']>.25
(ROOT/'tmp/mine-headframe-stage1-rope.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print('HEADFRAME_ROPE_CLEARANCE_PASS '+json.dumps(result))
