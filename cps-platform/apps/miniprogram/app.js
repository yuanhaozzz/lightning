const localConfig = require('./config');
const { request } = require('./utils/request');
const { readChannel } = require('./utils/channel');

App({
  globalData: { config: null, channelCode: '' },
  onLaunch(options) {
    try { this.globalData.channelCode = readChannel({ channel: wx.getStorageSync('cps_channel') }); } catch (_) {}
    this.captureChannel(options);
  },
  onShow(options) { this.captureChannel(options); },
  captureChannel(options) {
    const channelCode = readChannel((options && options.query) || {});
    if (!channelCode) return;
    this.globalData.channelCode = channelCode;
    try { wx.setStorageSync('cps_channel', channelCode); } catch (_) {}
  },
  getConfig(force) {
    if (!force && this.globalData.config) return Promise.resolve(this.globalData.config);
    if (this.configPromise) return this.configPromise;
    this.configPromise = request('/api/public/config').then((config) => {
      if (!config || !['demo', 'live'].includes(config.mode)) throw new Error('服务配置暂不可用，请稍后重试');
      if (config.mode === 'live') {
        let appId = '';
        try { appId = wx.getAccountInfoSync().miniProgram.appId; } catch (_) {}
        if (!/^wx[0-9a-fA-F]{16}$/.test(appId)) throw new Error('正式服务需配置你的小程序 AppID；当前工程仅供演示');
      }
      const safeConfig = Object.assign({}, config, {
        siteName: config.siteName || localConfig.siteName,
        categories: Array.isArray(config.categories) ? config.categories : []
      });
      this.globalData.config = safeConfig;
      return safeConfig;
    }).finally(() => { this.configPromise = null; });
    return this.configPromise;
  }
});
