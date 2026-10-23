// 开发者工具本机调试。真机无法访问电脑的 127.0.0.1。
// 发布前替换为生产 HTTPS API 域名，并在微信公众平台配置 request 合法域名。
module.exports = {
  API_BASE: 'http://127.0.0.1:3018',
  siteName: '青岛省心券',
  REQUEST_TIMEOUT: 12000
};
