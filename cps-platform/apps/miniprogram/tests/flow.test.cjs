const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const channelModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/channel.js'), 'utf8'), { module: channelModule });
const { readChannel } = channelModule.exports;

function pageFixture(response) {
  let definition;
  const calls = { requests: [], navigations: [], modals: [] };
  const app = { globalData: { channelCode: 'qd_office' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/offer/index.js'), 'utf8'), {
    Page(value) { definition = value; },
    getApp() { return app; },
    require() { return { request: async (...args) => { calls.requests.push(args); return response; } }; },
    wx: {
      showModal(value) { calls.modals.push(value); },
      navigateToMiniProgram(value) { calls.navigations.push(value); value.complete(); },
      showToast() {}
    }
  });
  const page = Object.assign({}, definition, { data: Object.assign({}, definition.data, { offer: { id: 'test' } }), offerId: 'test' });
  page.setData = (data) => Object.assign(page.data, data);
  return { page, calls };
}

test('channel accepts explicit or QR scene codes and rejects malformed values', () => {
  assert.equal(readChannel({ channel: 'qd_office' }), 'qd_office');
  assert.equal(readChannel({ scene: 'channel%3Dqd_office' }), 'qd_office');
  assert.equal(readChannel({ scene: 'qd_office' }), 'qd_office');
  assert.equal(readChannel({ scene: 'channel%3DQD' }), '');
  assert.equal(readChannel({ scene: '%E0%A4%A' }), '');
  assert.equal(readChannel({ channel: '../secret' }), '');
  assert.equal(readChannel({ channel: 'x'.repeat(33) }), '');
  assert.equal(readChannel({ scene: 1001 }), '');
});

test('demo launch only informs; never navigates or reports a successful claim', async () => {
  const { page, calls } = pageFixture({ mode: 'demo', message: '演示优惠不可领取' });
  await page.onClaim();
  assert.equal(calls.navigations.length, 0);
  assert.equal(calls.modals.length, 1);
  assert.equal(calls.modals[0].title, '当前为演示模式');
  assert.equal(page.data.ready, false);
  assert.equal(page.data.claiming, false);
  assert.equal(calls.requests[0][1].data.channelCode, 'qd_office');
});

test('live launch requires a second user action and preserves exact server target', async () => {
  const target = { mode: 'live', appId: 'wx0123456789abcdef', path: 'pages/offer/index?promotion=real' };
  const { page, calls } = pageFixture(target);
  await page.onClaim();
  assert.equal(calls.navigations.length, 0);
  assert.equal(page.data.ready, true);
  await page.onClaim();
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.navigations.length, 1);
  assert.equal(calls.navigations[0].appId, target.appId);
  assert.equal(calls.navigations[0].path, target.path);
  assert.equal(page.data.ready, false);
});

test('unconfigured or invalid live target cannot navigate', async () => {
  const { page, calls } = pageFixture({ mode: 'live', appId: 'touristappid', path: '' });
  await page.onClaim();
  assert.equal(calls.navigations.length, 0);
  assert.equal(calls.modals[0].title, '暂时无法领取');
  assert.equal(page.data.ready, false);
});

test('HTTP errors expose server message and finish request loading state', async () => {
  let pending;
  const calls = [];
  const exports = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8'), {
    module: exports,
    require() { return { API_BASE: 'https://api.example.test', REQUEST_TIMEOUT: 1000 }; },
    wx: { request(options) { pending = options; }, showLoading() { calls.push('show'); }, hideLoading() { calls.push('hide'); } }
  });
  const result = exports.exports.request('/api/public/offers/test/launch', { method: 'POST', loading: true });
  pending.success({ statusCode: 403, data: { error: { code: 'NOT_READY', message: '服务尚未开通' } } });
  pending.complete();
  await assert.rejects(result, { message: '服务尚未开通', code: 'NOT_READY' });
  assert.deepEqual(calls, ['show', 'hide']);
});

test('tourist AppID cannot load a live service configuration', async () => {
  let app;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    App(value) { app = value; },
    require(id) {
      if (id === './config') return { siteName: '青岛省心券' };
      if (id === './utils/channel') return { readChannel };
      return { request: async () => ({ mode: 'live', categories: [] }) };
    },
    wx: { getAccountInfoSync() { return { miniProgram: { appId: 'touristappid' } }; } }
  });
  await assert.rejects(app.getConfig(), /正式服务需配置/);
  assert.equal(app.globalData.config, null);
});
