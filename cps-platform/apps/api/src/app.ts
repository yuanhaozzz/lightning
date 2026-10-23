import Fastify from 'fastify';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { openDatabase, seedDatabase, audit, offerDto, orderDto, publicOfferDto } from './db.js';
import { bootstrapAdministrator, constantEqual, hashPassword, newSession, readSession, sessionCookie, verifyPassword } from './auth.js';

const channelCode = z.string().regex(/^[a-z0-9_-]{2,32}$/);
const offerSchema = z.object({
  title: z.string().trim().min(2).max(80), platform: z.enum(['meituan', 'other']),
  category: z.enum(['food', 'coffee', 'travel', 'other']), description: z.string().max(1200).default(''),
  benefitText: z.string().trim().min(1).max(120), status: z.enum(['draft', 'active']).default('draft'),
  targetAppId: z.string().max(32).default(''), targetPath: z.string().max(2048).default(''),
  sortOrder: z.number().int().min(0).max(9999).default(0),
}).strict();
const importOrderSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(100), platform: z.enum(['meituan', 'other']),
  status: z.enum(['pending', 'valid', 'settled', 'invalid']),
  orderAmountCents: z.number().int().min(0).max(100_000_000), commissionCents: z.number().int().min(0).max(100_000_000),
  channelCode: channelCode.default('direct'), orderedAt: z.string().datetime(), settledAt: z.string().datetime().nullable().default(null),
}).strict().refine(o => o.status !== 'settled' || o.settledAt !== null, '已结算订单必须有 settledAt');
const categories = [{id:'food',name:'外卖午餐'}, {id:'coffee',name:'咖啡茶饮'}, {id:'travel',name:'出行生活'}, {id:'other',name:'其他服务'}];
const hasTarget = (o: {targetAppId:string;targetPath:string}) => /^wx[a-fA-F0-9]{16}$/.test(o.targetAppId)
  && o.targetPath.length > 0 && !/^\w+:/.test(o.targetPath) && !o.targetPath.startsWith('//') && !/[\r\n\x00]/.test(o.targetPath);
class ApiError extends Error { constructor(public statusCode:number, public code:string, message:string) { super(message); } }

export async function createApp(config: Config) {
  const db = openDatabase(config.databasePath);
  try { await bootstrapAdministrator(db, config); } catch (error) { db.close(); throw error; }
  seedDatabase(db, config.demo);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: '127.0.0.1', requestTimeout: 15000 });
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const mode = config.demo ? 'demo' : 'live'; const modeInt = config.demo ? 1 : 0;
  const rateBuckets = new Map<string, {count:number;expires:number}>();
  function rateLimit(key:string, limit:number, windowMs:number) {
    const now = Date.now();
    if (rateBuckets.size > 5000) for (const [k,v] of rateBuckets) if (v.expires < now) rateBuckets.delete(k);
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.expires < now) { bucket = { count:0, expires:now+windowMs }; rateBuckets.set(key,bucket); }
    if (++bucket.count > limit) throw new ApiError(429,'rate_limited','请求过于频繁，请稍后再试。');
    if (rateBuckets.size > 10000) throw new ApiError(503,'busy','服务繁忙，请稍后再试。');
  }
  const administrator = (request:any) => readSession(db, request.headers.cookie)?.username || '';
  const offerById = (id:string) => db.prepare('SELECT * FROM offers WHERE id=? AND is_demo=?').get(id, modeInt);
  app.addHook('onClose', async () => db.close());
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options','nosniff').header('Cache-Control','no-store').header('X-Frame-Options','DENY');
    // Use Fastify's matched route, not raw encoded URL: /%61pi/admin/... also matches admin routes.
    const pathname = request.routeOptions.url || '';
    const mutating = !['GET','HEAD','OPTIONS'].includes(request.method);
    if (pathname.startsWith('/api/public/')) rateLimit(`public:${request.ip}`,180,60_000);
    if (pathname === '/api/admin/login') rateLimit(`login:${request.ip}`,10,15*60_000);
    if (pathname.startsWith('/api/admin/')) {
      if (mutating && request.headers.origin) {
        const accepted = config.production ? [config.publicOrigin] : ['http://127.0.0.1:5178','http://localhost:5178',`http://127.0.0.1:${config.port}`, config.publicOrigin];
        if (!accepted.includes(request.headers.origin)) throw new ApiError(403,'invalid_origin','请求来源不被允许。');
      }
      if (pathname === '/api/admin/login') return;
      const session = readSession(db, request.headers.cookie);
      if (!session) throw new ApiError(401,'unauthorized','请先登录管理后台。');
      if (mutating && !constantEqual(String(request.headers['x-csrf-token'] || ''), session.csrf)) throw new ApiError(403,'invalid_csrf','会话校验失败，请刷新后重试。');
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({error:{code:'validation_error',message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；')}});
    if (error instanceof ApiError) return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) return reply.code(409).send({error:{code:'conflict',message:'标识已存在，请更换后重试。'}});
    const candidate = error && typeof error==='object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof candidate==='number' && candidate>=400 && candidate<500 ? candidate : 500;
    if(status===500) console.error('Unexpected API error:',error instanceof Error ? error.name : 'unknown');
    return reply.code(status).send({error:{code:status===500?'internal_error':'bad_request',message:status===500?'服务暂时不可用，请检查服务端日志。':'请求格式错误。'}});
  });
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:'not_found',message:'接口不存在。'}}));

  app.get('/api/health', async () => ({ok:true,mode}));
  app.post('/api/admin/login', async (request,reply) => {
    const body = z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(256)}).strict().parse(request.body);
    const admin = db.prepare('SELECT * FROM administrators WHERE username=?').get(body.username);
    const valid = await verifyPassword(body.password, String(admin?.password_hash || dummyHash));
    if (!admin || !valid) throw new ApiError(401,'invalid_credentials','账号或密码不正确。');
    const session = newSession(db,body.username);
    reply.header('Set-Cookie',sessionCookie(session.token,config.production));
    audit(db,body.username,'login');
    return {user:{username:body.username},csrfToken:session.csrfToken};
  });
  app.get('/api/admin/session', async request => {const s=readSession(db,request.headers.cookie)!;return {user:{username:s.username},csrfToken:s.csrf};});
  app.delete('/api/admin/session', async (request,reply) => {
    const s=readSession(db,request.headers.cookie)!;db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);
    reply.header('Set-Cookie',sessionCookie('',config.production,true));return {ok:true};
  });
  app.get('/api/admin/overview', async () => {
    const count = (sql:string) => Number(db.prepare(sql).get(modeInt)?.n || 0);
    const totals = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('pending','valid') THEN commission_cents ELSE 0 END),0) AS estimated,
      COALESCE(SUM(CASE WHEN status='settled' THEN commission_cents ELSE 0 END),0) AS settled FROM orders WHERE is_demo=?`).get(modeInt)!;
    const daily = Array.from({length:7},(_,i)=>{
      const date = new Date(Date.now()+8*3600_000-(6-i)*86400_000).toISOString().slice(0,10);
      const from=new Date(`${date}T00:00:00+08:00`).toISOString();
      const until=new Date(Date.parse(from)+86400_000).toISOString();
      const clicks=Number(db.prepare('SELECT COUNT(*) AS n FROM clicks WHERE is_demo=? AND created_at>=? AND created_at<?').get(modeInt,from,until)?.n || 0);
      const orders=db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(CASE WHEN status='settled' THEN commission_cents ELSE 0 END),0) AS c FROM orders WHERE is_demo=? AND ordered_at>=? AND ordered_at<?`).get(modeInt,from,until)!;
      return {date,clicks,orders:Number(orders.n),commissionCents:Number(orders.c)};
    });
    return {mode,metrics:{offers:count('SELECT COUNT(*) AS n FROM offers WHERE is_demo=?'),enabledOffers:count("SELECT COUNT(*) AS n FROM offers WHERE status='active' AND is_demo=?"),
      clicks:count('SELECT COUNT(*) AS n FROM clicks WHERE is_demo=?'),orders:count('SELECT COUNT(*) AS n FROM orders WHERE is_demo=?'),
      estimatedCommissionCents:Number(totals.estimated),settledCommissionCents:Number(totals.settled)},daily,
      onboarding:[
        {id:'account',title:'申请官方联盟推广账号',status:'pending',description:'完成主体认证、媒体登记及推广位申请；须在官方后台核验。'},
        {id:'api',title:'申请转链、商品和订单权限',status:'pending',description:'本版尚未启用联盟API。取得官方鉴权文档后接入。'},
        {id:'target',title:'配置真实小程序推广路径',status:count("SELECT COUNT(*) AS n FROM offers WHERE target_app_id<>'' AND target_path<>'' AND is_demo=?")>0?'done':'pending',description:'可先手工录入官方提供的目标AppID及完整跟单路径。'},
        {id:'domain',title:'配置HTTPS域名与微信合法域名',status:config.publicOrigin?'done':'pending',description:'服务器域名、证书及小程序request域名需实际核验。'}
      ],recentOrders:db.prepare('SELECT * FROM orders WHERE is_demo=? ORDER BY ordered_at DESC LIMIT 5').all(modeInt).map(orderDto)};
  });
  app.get('/api/admin/offers', async () => ({items:db.prepare('SELECT * FROM offers WHERE is_demo=? ORDER BY sort_order,created_at DESC').all(modeInt).map(offerDto)}));
  app.post('/api/admin/offers', async (request,reply) => {
    const o=offerSchema.parse(request.body);
    if (!config.demo && o.status==='active' && !hasTarget(o)) throw new ApiError(400,'target_required','正式模式上架需要有效目标AppID和小程序推广路径。');
    if ((o.targetAppId || o.targetPath) && !hasTarget(o)) throw new ApiError(400,'invalid_target','请填写完整的小程序AppID与相对页面路径，不能使用H5网址。');
    const id=randomUUID();const now=new Date().toISOString();
    db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,o.title,o.platform,o.category,o.description,o.benefitText,o.status,o.targetAppId,o.targetPath,o.sortOrder,modeInt,now,now);
    audit(db,administrator(request),'offer.create',id);return reply.code(201).send({item:offerDto(offerById(id))});
  });
  app.patch('/api/admin/offers/:id', async request => {
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);const current=offerById(id);
    if (!current) throw new ApiError(404,'not_found','优惠不存在。');
    const patch=offerSchema.partial().parse(request.body);const prev=offerDto(current);
    const o=offerSchema.parse({...Object.fromEntries(Object.keys(offerSchema.shape).map(k=>[k,(prev as any)[k]])),...patch});
    if ((!config.demo && o.status==='active' || o.targetAppId || o.targetPath) && !hasTarget(o)) throw new ApiError(400,'invalid_target','正式优惠需要有效目标AppID和小程序推广路径。');
    db.prepare('UPDATE offers SET title=?,platform=?,category=?,description=?,benefit_text=?,status=?,target_app_id=?,target_path=?,sort_order=?,updated_at=? WHERE id=?')
      .run(o.title,o.platform,o.category,o.description,o.benefitText,o.status,o.targetAppId,o.targetPath,o.sortOrder,new Date().toISOString(),id);
    audit(db,administrator(request),'offer.update',id);return {item:offerDto(offerById(id))};
  });
  app.get('/api/admin/channels',async()=>({items:db.prepare('SELECT id,code,name,created_at AS createdAt FROM channels ORDER BY created_at DESC').all()}));
  app.post('/api/admin/channels',async(request,reply)=>{
    const body=z.object({code:channelCode,name:z.string().trim().min(1).max(80)}).strict().parse(request.body);const id=randomUUID();const createdAt=new Date().toISOString();
    db.prepare('INSERT INTO channels VALUES(?,?,?,?)').run(id,body.code,body.name,createdAt);audit(db,administrator(request),'channel.create',id);
    return reply.code(201).send({item:{id,...body,createdAt}});
  });
  app.get('/api/admin/orders',async request=>{
    const q=z.object({limit:z.coerce.number().int().min(1).max(500).default(200),offset:z.coerce.number().int().min(0).default(0)}).parse(request.query);
    return {items:db.prepare('SELECT * FROM orders WHERE is_demo=? ORDER BY ordered_at DESC LIMIT ? OFFSET ?').all(modeInt,q.limit,q.offset).map(orderDto),
      total:Number(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE is_demo=?').get(modeInt)!.n),limit:q.limit,offset:q.offset};
  });
  app.post('/api/admin/orders/demo',async request=>{
    if (!config.demo) throw new ApiError(403,'demo_disabled','正式模式禁止生成演示订单。');
    const body=z.object({channelCode:channelCode.optional()}).strict().parse(request.body || {});const code=body.channelCode || 'direct';
    if (!db.prepare('SELECT code FROM channels WHERE code=?').get(code)) throw new ApiError(400,'invalid_channel','渠道不存在。');
    const id=randomUUID();const now=new Date().toISOString();
    db.prepare('INSERT INTO orders(id,external_order_id,platform,status,order_amount_cents,commission_cents,channel_code,ordered_at,settled_at,is_demo,source) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,`DEMO-${randomUUID()}`,'meituan','settled',2500,80,code,now,now,1,'demo');
    audit(db,administrator(request),'order.demo',id);return {item:orderDto(db.prepare('SELECT * FROM orders WHERE id=?').get(id))};
  });
  app.post('/api/admin/orders/import',async request=>{
    const {orders}=z.object({orders:z.array(importOrderSchema).min(1).max(500)}).strict().parse(request.body);
    const upsert=db.prepare(`INSERT INTO orders(id,external_order_id,platform,status,order_amount_cents,commission_cents,channel_code,ordered_at,settled_at,is_demo,source) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,external_order_id,is_demo) DO UPDATE SET
      status=excluded.status,order_amount_cents=excluded.order_amount_cents,commission_cents=excluded.commission_cents,
      channel_code=excluded.channel_code,ordered_at=excluded.ordered_at,settled_at=excluded.settled_at,source=excluded.source`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const o of orders) {
        if(!db.prepare('SELECT code FROM channels WHERE code=?').get(o.channelCode)) throw new ApiError(400,'invalid_channel',`渠道 ${o.channelCode} 不存在。`);
        upsert.run(randomUUID(),o.externalOrderId,o.platform,o.status,o.orderAmountCents,o.commissionCents,o.channelCode,o.orderedAt,o.settledAt,modeInt,'manual');
      }
      audit(db,administrator(request),'order.import',String(orders.length));db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    return {ok:true,count:orders.length,source:'manual',message:'已保存为人工导入记录；不代表平台核验或银行到账。'};
  });
  app.get('/api/admin/settings',async()=>({mode,siteName:config.siteName,supportWechat:config.supportWechat,
    provider:{name:'美团联盟（待开通API；当前支持手工推广路径）',credentialsConfigured:config.providerCredentialsConfigured,apiEnabled:false},
    deployment:{publicOriginConfigured:Boolean(config.publicOrigin)},limitations:[
      '尚未开通真实联盟API；配置密钥不会自动启用对接。',
      '当前正式领券支持手工录入官方目标AppID和跟单路径；渠道统计仅代表本系统点击来源。',
      '手工目标不会自动写入上游sid，真实订单归因需以联盟规则及后台数据为准。',
      '订单人工导入不等于平台核验；结算状态不等于银行实际到账。',
      '本系统不收消费者订单款、不提供消费者现金返利、不会永久绑定用户。'
    ]}));
  app.get('/api/public/config',async()=>({siteName:config.siteName,mode,supportWechat:config.supportWechat,categories,
    notice:config.demo?'当前为演示环境，优惠与订单样例不代表真实权益或收益。':'优惠适用范围、价格与期限以官方平台页面为准。',
    privacyText:'本服务无需登录，不采集手机号和微信身份信息。点击优惠时记录优惠编号、渠道标记和时间，用于汇总运营效果。订单由目标平台处理。客服沟通时请勿发送支付密码等敏感信息。上线前经营者须补充与实际业务一致的隐私保护说明。'}));
  app.get('/api/public/offers',async request=>{
    const q=z.object({category:z.string().max(20).optional(),search:z.string().max(80).optional()}).parse(request.query);
    const rows=db.prepare("SELECT * FROM offers WHERE status='active' AND is_demo=? AND (?='' OR category=?) AND (?='' OR title LIKE ? OR description LIKE ?) ORDER BY sort_order,created_at DESC LIMIT 200")
      .all(modeInt,q.category||'',q.category||'',q.search||'',`%${q.search||''}%`,`%${q.search||''}%`);
    return {items:rows.map(publicOfferDto)};
  });
  app.get('/api/public/offers/:id',async request=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);const o=offerById(id);
    if(!o || o.status!=='active') throw new ApiError(404,'not_found','该优惠暂不可用。');return {item:publicOfferDto(o)};
  });
  app.post('/api/public/offers/:id/launch',async request=>{
    rateLimit(`launch:${request.ip}`,30,60_000);
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({channelCode:channelCode.optional()}).strict().parse(request.body||{});
    const row=offerById(id);if(!row||row.status!=='active') throw new ApiError(404,'not_found','该优惠暂不可用。');
    const o=offerDto(row);if(!config.demo&&!hasTarget(o)) throw new ApiError(409,'target_not_configured','该优惠暂未完成对接。');
    const candidate=body.channelCode||'direct';const code=db.prepare('SELECT code FROM channels WHERE code=?').get(candidate)?candidate:'direct';
    db.prepare('INSERT INTO clicks VALUES(?,?,?,?,?)').run(randomUUID(),id,code,modeInt,new Date().toISOString());
    if(config.demo)return {mode:'demo',message:'这是演示优惠，尚未接入真实活动；不会跳转或产生佣金。'};
    return {mode:'live',appId:o.targetAppId,path:o.targetPath};
  });
  return app;
}
