const { request } = require('../../utils/request');

Page({
  data: { mode: 'demo', offer: null, loading: true, error: '', claiming: false, ready: false },
  onLoad(options) { this.offerId = options.id || ''; this.loadOffer(); },
  async loadOffer() {
    this.target = null;
    this.setData({ loading: true, error: '', ready: false });
    if (!this.offerId) { this.setData({ loading: false, error: '优惠链接不完整，请返回首页重新选择' }); return; }
    try {
      const results = await Promise.all([getApp().getConfig(true), request('/api/public/offers/' + encodeURIComponent(this.offerId))]);
      if (!results[1].item) throw new Error('这项优惠暂不可用');
      this.setData({ mode: results[0].mode, offer: results[1].item });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  async onClaim() {
    if (this.data.claiming || !this.data.offer) return;
    if (this.target) { this.openTarget(); return; }
    this.setData({ claiming: true });
    try {
      const channelCode = getApp().globalData.channelCode;
      const result = await request('/api/public/offers/' + encodeURIComponent(this.offerId) + '/launch', {
        method: 'POST', data: channelCode ? { channelCode } : {}, loading: true
      });
      if (result.mode === 'demo') {
        this.setData({ mode: 'demo' });
        wx.showModal({ title: '当前为演示模式', content: result.message || '这是示例优惠，没有实际领取，也不会产生订单。', showCancel: false, confirmText: '知道了', confirmColor: '#12654f' });
        return;
      }
      if (result.mode !== 'live' || !/^wx[0-9a-fA-F]{16}$/.test(result.appId || '') || typeof result.path !== 'string' || !result.path || /[\r\n]/.test(result.path)) {
        throw new Error('领取入口暂不可用，请稍后再试');
      }
      // 仅接受服务端返回的实际目标；第二次主动点击同步发起跳转。
      // 准备入口不是领券成功或下单成功。
      this.target = { appId: result.appId, path: result.path };
      this.setData({ mode: 'live', ready: true });
    } catch (error) { wx.showModal({ title: '暂时无法领取', content: error.message, showCancel: false, confirmColor: '#12654f' }); }
    finally { this.setData({ claiming: false }); }
  },
  openTarget() {
    if (!this.target || this.data.mode !== 'live') return;
    this.setData({ claiming: true });
    wx.navigateToMiniProgram({
      appId: this.target.appId,
      path: this.target.path,
      envVersion: 'release',
      fail(error) {
        const canceled = /cancel/i.test(error.errMsg || '');
        wx.showToast({ title: canceled ? '已取消打开' : '暂时无法打开平台，请稍后重试', icon: 'none' });
      },
      complete: () => { this.target = null; this.setData({ claiming: false, ready: false }); }
    });
  },
  onHome() { wx.switchTab({ url: '/pages/home/index' }); },
  onGuide() { wx.switchTab({ url: '/pages/guide/index' }); }
});
