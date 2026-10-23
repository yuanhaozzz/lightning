import { resolve } from 'node:path';

export interface Config {
  production: boolean; host: string; port: number; databasePath: string;
  demo: boolean; siteName: string; adminUsername: string; adminPassword: string;
  publicOrigin: string; supportWechat: string; providerCredentialsConfigured: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const demo = env.DEMO_MODE !== 'false';
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const adminPassword = env.ADMIN_PASSWORD || '';
  if (adminPassword && (adminPassword.length < 12 || /^(change|replace|password)/i.test(adminPassword))) {
    throw new Error('ADMIN_PASSWORD 必须是至少 12 位的自定义密码，不能使用占位值。');
  }
  if (production && (!publicOrigin.startsWith('https://') || demo)) {
    throw new Error('生产启动需要 HTTPS PUBLIC_ORIGIN 和 DEMO_MODE=false。');
  }
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.origin !== publicOrigin || !['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_ORIGIN 必须是完整源地址，不包含路径。');
  }
  const port = Number(env.PORT || 3018);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  return {
    production, demo, publicOrigin, adminPassword, host: env.HOST || '127.0.0.1', port,
    databasePath: env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(env.DATABASE_PATH || './data/cps.sqlite'),
    siteName: env.SITE_NAME || '青岛省心券', adminUsername: env.ADMIN_USERNAME || 'admin',
    supportWechat: env.SUPPORT_WECHAT || '',
    providerCredentialsConfigured: Boolean(env.MEITUAN_APP_KEY && env.MEITUAN_APP_SECRET),
  };
}
