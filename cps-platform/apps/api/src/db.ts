import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS administrators (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL, benefit_text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','active')),
      target_app_id TEXT NOT NULL DEFAULT '', target_path TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clicks (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, channel_code TEXT NOT NULL, is_demo INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS clicks_created ON clicks(created_at);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, external_order_id TEXT NOT NULL, platform TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','valid','settled','invalid')),
      order_amount_cents INTEGER NOT NULL CHECK(order_amount_cents >= 0), commission_cents INTEGER NOT NULL CHECK(commission_cents >= 0),
      channel_code TEXT NOT NULL, ordered_at TEXT NOT NULL, settled_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manual',
      UNIQUE(platform, external_order_id, is_demo)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL);
  `);
  return db;
}

export function seedDatabase(db: DatabaseSync, demo: boolean) {
  db.prepare('INSERT OR IGNORE INTO channels(id,code,name,created_at) VALUES(?,?,?,?)')
    .run(randomUUID(), 'direct', '直接访问', new Date().toISOString());
  if (!demo || Number(db.prepare('SELECT COUNT(*) AS n FROM offers').get()!.n) > 0) return;
  const insert = db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [index, item] of [
    ['演示 · 午餐优惠入口', 'food', '展示午餐优惠入口；接入官方推广后替换为真实活动。'],
    ['演示 · 咖啡与下午茶', 'coffee', '展示咖啡活动入口；本条没有真实优惠或佣金。'],
    ['演示 · 周末出行', 'travel', '展示出行服务入口；暂未接入供应方。'],
  ].entries()) {
    const now = new Date().toISOString();
    insert.run(randomUUID(), item[0], 'meituan', item[1], item[2], '演示内容，暂不可领取', 'active', '', '', index, 1, now, now);
  }
}

export function audit(db: DatabaseSync, actor: string, action: string, entityId = '') {
  db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?)').run(randomUUID(), actor, action, entityId, new Date().toISOString());
}

export function offerDto(row: any) {
  return { id: row.id, title: row.title, platform: row.platform, category: row.category, description: row.description,
    benefitText: row.benefit_text, status: row.status, targetAppId: row.target_app_id, targetPath: row.target_path,
    sortOrder: row.sort_order, isDemo: Boolean(row.is_demo), createdAt: row.created_at, updatedAt: row.updated_at };
}
export function publicOfferDto(row: any) {
  const offer = offerDto(row);
  return { id: offer.id, title: offer.title, platform: offer.platform, category: offer.category,
    description: offer.description, benefitText: offer.benefitText, isDemo: offer.isDemo };
}
export function orderDto(row: any) {
  return { id: row.id, externalOrderId: row.external_order_id, platform: row.platform, status: row.status,
    orderAmountCents: row.order_amount_cents, commissionCents: row.commission_cents, channelCode: row.channel_code,
    orderedAt: row.ordered_at, settledAt: row.settled_at, isDemo: Boolean(row.is_demo), source: row.source };
}
