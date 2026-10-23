import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config = loadConfig();
const app = await createApp(config);
try {
  await app.listen({host:config.host,port:config.port});
  console.info(`CPS API: http://${config.host}:${config.port} [${config.demo?'DEMO':'LIVE · manual promotion targets'}]`);
} catch(error) {console.error(error instanceof Error?error.message:'服务启动失败');await app.close();process.exit(1);}
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,async()=>{await app.close();process.exit(0);});
