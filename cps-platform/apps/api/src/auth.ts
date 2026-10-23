import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';

const scrypt = promisify(nodeScrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, value] = stored.split(':');
  const candidate = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(value || '', 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export function constantEqual(a: string, b: string) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export async function bootstrapAdministrator(db: DatabaseSync, config: Config) {
  const existing = db.prepare('SELECT username FROM administrators WHERE username=?').get(config.adminUsername);
  if (!existing) {
    if (!config.adminPassword) throw new Error('首次启动请在 apps/api/.env.local 设置 ADMIN_PASSWORD（至少12位）。');
    db.prepare('INSERT INTO administrators VALUES(?,?)').run(config.adminUsername, await hashPassword(config.adminPassword));
  }
}
export function newSession(db: DatabaseSync, username: string) {
  const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), username, csrfToken, Date.now() + 8 * 3600_000);
  return { token, csrfToken };
}
export function readSession(db: DatabaseSync, cookie = '') {
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cps_session='))?.slice(12);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.prepare('SELECT username,csrf,token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) as {username:string;csrf:string;token_hash:string}|undefined;
}
export function sessionCookie(token: string, production: boolean, clear = false) {
  return `cps_session=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 8 * 3600}${production ? '; Secure' : ''}`;
}
