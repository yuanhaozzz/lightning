import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
const config = loadConfig();
const destination = resolve(process.env.BACKUP_DIR || './backups');
mkdirSync(destination,{recursive:true});
const db = new DatabaseSync(config.databasePath,{readOnly:true});
const file = resolve(destination,`cps-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
try {await backup(db,file);console.info(`Backup saved: ${file}`);}finally{db.close();}
