import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsc=fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
const compile=spawn(process.execPath,[tsc,'-p','tsconfig.json'],{stdio:'inherit'});
const code=await new Promise(resolve=>compile.once('exit',resolve));
if(code!==0)process.exit(Number(code)||1);
const children=[
  spawn(process.execPath,[tsc,'-p','tsconfig.json','--watch','--preserveWatchOutput'],{stdio:'inherit'}),
  spawn(process.execPath,['--env-file-if-exists=.env.local','--watch','dist/index.js'],{stdio:'inherit'})
];
let closing=false;
function stop(code=0){if(closing)return;closing=true;for(const child of children)child.kill();process.exit(code);}
for(const child of children)child.once('exit',code=>stop(code||0));
process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
