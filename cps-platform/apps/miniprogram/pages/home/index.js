const localConfig = require('../../config');
const { request } = require('../../utils/request');

Page({
  data: {
    siteName: localConfig.siteName, mode: 'demo', notice: '', categories: [],
    activeCategory: '', search: '', offers: [], loading: true, error: ''
  },
  onLoad() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()); },
  async loadPage(force) {
    this.setData({ loading: true, error: '' });
    try {
      const config = await getApp().getConfig(force);
      this.setData({ siteName: config.siteName, mode: config.mode, notice: config.notice || '', categories: config.categories });
      wx.setNavigationBarTitle({ title: config.siteName });
      await this.loadOffers();
    } catch (error) { this.setData({ loading: false, error: error.message }); }
  },
  async loadOffers() {
    const sequence = this.requestSequence = (this.requestSequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    const params = '?category=' + encodeURIComponent(this.data.activeCategory) + '&search=' + encodeURIComponent(this.data.search.trim());
    try {
      const result = await request('/api/public/offers' + params);
      if (sequence === this.requestSequence) this.setData({ offers: Array.isArray(result.items) ? result.items : [] });
    } catch (error) {
      if (sequence === this.requestSequence) this.setData({ error: error.message });
    } finally {
      if (sequence === this.requestSequence) this.setData({ loading: false });
    }
  },
  onSearchInput(event) { this.setData({ search: event.detail.value }); },
  onSearch() { this.loadOffers(); },
  onCategory(event) { this.setData({ activeCategory: event.currentTarget.dataset.id || '' }); this.loadOffers(); },
  onReset() { this.setData({ activeCategory: '', search: '' }); this.loadOffers(); },
  onRetry() { this.loadPage(true); },
  onOffer(event) {
    wx.navigateTo({ url: '/pages/offer/index?id=' + encodeURIComponent(event.currentTarget.dataset.id), fail() { wx.showToast({ title: '页面暂时无法打开', icon: 'none' }); } });
  },
  onGuide() { wx.switchTab({ url: '/pages/guide/index' }); }
});
