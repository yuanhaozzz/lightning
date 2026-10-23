const { API_BASE, REQUEST_TIMEOUT } = require('../config');
let loadingCount = 0;

function request(path, options) {
  const opts = options || {};
  const showLoading = Boolean(opts.loading);
  if (showLoading && loadingCount++ === 0) wx.showLoading({ title: '请稍候', mask: true });
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE.replace(/\/$/, '') + path,
      method: opts.method || 'GET',
      data: opts.data,
      timeout: REQUEST_TIMEOUT,
      header: { 'content-type': 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
        } else {
          const serverError = response.data && response.data.error;
          const error = new Error((serverError && serverError.message) || '服务暂不可用，请稍后重试');
          error.code = serverError && serverError.code;
          error.statusCode = response.statusCode;
          reject(error);
        }
      },
      fail() { reject(new Error('连接失败，请检查网络后重试')); },
      complete() {
        if (showLoading && --loadingCount === 0) wx.hideLoading();
      }
    });
  });
}

module.exports = { request };
