import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = (demo=true) => loadConfig({DATABASE_PATH:':memory:',DEMO_MODE:String(demo),ADMIN_PASSWORD:'Test-only-password-52',NODE_ENV:'test'});
async function login(app:Awaited<ReturnType<typeof createApp>>) {
  const res=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'admin',password:'Test-only-password-52'}});
  assert.equal(res.statusCode,200);
  return {cookie:String(res.headers['set-cookie']).split(';')[0],'x-csrf-token':res.json().csrfToken};
}
test('admin access is authenticated, CSRF protected, origin checked and revoked on logout',async()=>{
  const app=await createApp(config());
  try {
    assert.equal((await app.inject('/api/admin/orders')).statusCode,401);
    assert.equal((await app.inject('/%61pi/admin/orders')).statusCode,401);
    assert.equal((await app.inject('/api/%61dmin/settings')).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/%61pi/admin/channels',payload:{code:'bypass',name:'禁止绕过'}})).statusCode,401);
    const headers=await login(app);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/channels',headers:{cookie:headers.cookie},payload:{code:'office',name:'办公'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/channels',headers:{...headers,origin:'https://evil.invalid'},payload:{code:'office',name:'办公'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/channels',headers,payload:{code:'office',name:'办公'}})).statusCode,201);
    assert.equal((await app.inject({method:'DELETE',url:'/api/admin/session',headers})).statusCode,200);
    assert.equal((await app.inject({url:'/api/admin/orders',headers})).statusCode,401);
  } finally {await app.close();}
});
test('public click cannot create a real order; inactive offer is inaccessible',async()=>{
  const app=await createApp(config());
  try {
    const headers=await login(app);const offers=(await app.inject('/api/public/offers')).json().items;
    const result=await app.inject({method:'POST',url:`/api/public/offers/${offers[0].id}/launch`,payload:{channelCode:'unknown'}});
    assert.equal(result.json().mode,'demo');assert.equal(result.json().appId,undefined);
    const overview=(await app.inject({url:'/api/admin/overview',headers})).json();
    assert.equal(overview.metrics.clicks,1);assert.equal(overview.metrics.orders,0);assert.equal(overview.metrics.settledCommissionCents,0);
    assert.equal((await app.inject({method:'PATCH',url:`/api/admin/offers/${offers[0].id}`,headers,payload:{status:'draft'}})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:`/api/public/offers/${offers[0].id}/launch`,payload:{}})).statusCode,404);
  } finally {await app.close();}
});
test('live mode is empty initially, blocks demo generation and validates promotion targets',async()=>{
  const app=await createApp(config(false));
  try {
    const headers=await login(app);assert.deepEqual((await app.inject('/api/public/offers')).json().items,[]);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/orders/demo',headers,payload:{}})).statusCode,403);
    const payload={title:'测试授权活动',platform:'meituan',category:'food',description:'仅测试',benefitText:'以官方活动页为准',status:'active',targetAppId:'',targetPath:'',sortOrder:0};
    assert.equal((await app.inject({method:'POST',url:'/api/admin/offers',headers,payload})).statusCode,400);
    const created=await app.inject({method:'POST',url:'/api/admin/offers',headers,payload:{...payload,targetAppId:'wx0000000000000000',targetPath:'pages/index?test=1'}});
    assert.equal(created.statusCode,201);
    const launch=await app.inject({method:'POST',url:`/api/public/offers/${created.json().item.id}/launch`,payload:{}});
    assert.deepEqual(launch.json(),{mode:'live',appId:'wx0000000000000000',path:'pages/index?test=1'});
  } finally {await app.close();}
});
test('order import is idempotent and atomic; invalidated commissions no longer count',async()=>{
  const app=await createApp(config(false));
  try {
    const headers=await login(app);const order={externalOrderId:'UPSTREAM-1',platform:'meituan',status:'settled',orderAmountCents:2000,commissionCents:80,channelCode:'direct',orderedAt:'2026-10-18T02:00:00.000Z',settledAt:'2026-10-18T03:00:00.000Z'};
    const send=(orders:unknown[])=>app.inject({method:'POST',url:'/api/admin/orders/import',headers,payload:{orders}});
    assert.equal((await send([order])).statusCode,200);assert.equal((await send([order])).statusCode,200);
    assert.equal((await app.inject({url:'/api/admin/orders',headers})).json().total,1);
    assert.equal((await app.inject({url:'/api/admin/overview',headers})).json().metrics.settledCommissionCents,80);
    assert.equal((await send([{...order,externalOrderId:'UPSTREAM-2'},{...order,externalOrderId:'UPSTREAM-3',channelCode:'missing'}])).statusCode,400);
    assert.equal((await app.inject({url:'/api/admin/orders',headers})).json().total,1);
    await send([{...order,status:'invalid',settledAt:null}]);
    assert.equal((await app.inject({url:'/api/admin/overview',headers})).json().metrics.settledCommissionCents,0);
    assert.equal((await send([{...order,commissionCents:0.8}])).statusCode,400);
  } finally {await app.close();}
});
test('production fails closed without HTTPS and with demo mode',()=>{
  assert.throws(()=>loadConfig({NODE_ENV:'production',DEMO_MODE:'true',PUBLIC_ORIGIN:'https://cps.example.com'}));
  assert.throws(()=>loadConfig({NODE_ENV:'production',DEMO_MODE:'false',PUBLIC_ORIGIN:'http://cps.example.com'}));
});
