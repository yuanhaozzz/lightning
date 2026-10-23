const localConfig = require('../../config');

Page({
  data: { siteName: localConfig.siteName, mode: 'demo', supportWechat: '', privacyText: '', loading: true, error: '' },
  onShow() { this.loadConfig(); },
  async loadConfig() {
    this.setData({ loading: true, error: '' });
    try {
      const config = await getApp().getConfig(true);
      this.setData({ siteName: config.siteName, mode: config.mode, supportWechat: config.supportWechat || '', privacyText: config.privacyText || '' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  onCopySupport() {
    if (!this.data.supportWechat) return;
    wx.setClipboardData({ data: this.data.supportWechat, fail() { wx.showToast({ title: '复制失败，请手动记录客服微信', icon: 'none' }); } });
  },
  onClearChannel() {
    wx.showModal({
      title: '清除来源记录', content: '清除当前设备保存的推广来源，不影响浏览优惠。再次从带来源的链接进入时会重新记录。', confirmText: '清除记录', confirmColor: '#12654f',
      success(result) {
        if (!result.confirm) return;
        try { wx.removeStorageSync('cps_channel'); getApp().globalData.channelCode = ''; wx.showToast({ title: '已清除', icon: 'success' }); }
        catch (_) { wx.showToast({ title: '清除失败，请稍后重试', icon: 'none' }); }
      }
    });
  }
});
