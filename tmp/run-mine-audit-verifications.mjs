import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const root = pathToFileURL(process.cwd()+'/').href
const results=[]
for(const name of ['core_production','coal_transport','power_area','monitoring_devices','protection_facilities']) {
  let code=readFileSync(`scripts/blender/verify_${name}.mjs`,'utf8')
  code=code.replace(/new URL\('\.\.\/\.\.\/',\s*import\.meta\.url\)/g,`new URL(${JSON.stringify(root)})`)
  code=code.replace(/^import (.+) from '([^']+)'/gm,(full,binding,spec)=>`import ${binding} from '${spec.startsWith('node:')?spec:import.meta.resolve(spec)}'`)
  code=code.replace(/import \{\s*readFileSync,\s*writeFileSync\s*\} from 'node:fs'/,'import {readFileSync,writeFileSync as writeAuditOutput} from \'node:fs\'')
  code+=`\n//# sourceURL=readonly-verification-${name}.mjs\n`
  code=`${code}\n`
  code=code.replace(/(import[^\n]+from 'node:fs'\s*\n)/,`$1const writeFileSync=(_p,data)=>writeAuditOutput(${JSON.stringify(path.resolve('tmp',`mine-quality-${name}.verification.json`))},data);\n`)
  try { await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));results.push({name,result:'PASS'}) }
  catch(error) {results.push({name,result:'FAIL',message:error.message});console.error(name,error.message)}
}
writeFileSync('tmp/mine-quality-verification-results.json',JSON.stringify(results,null,2))
console.log('READ_ONLY_VERIFICATION_SUMMARY '+JSON.stringify(results))
if(results.some(x=>x.result==='FAIL'))process.exitCode=1
