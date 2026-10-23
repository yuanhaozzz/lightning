# 阿里云轻量部署方案

目标：单台 Linux、2核2GB 起步。现有机器的系统、CPU/内存、磁盘、带宽、域名和其他服务尚未连接核实；本次未执行远程部署。

## 结构

微信小程序 → HTTPS Nginx `/api/` → 本机 Fastify `127.0.0.1:3018` → SQLite。

管理端 → 同一 HTTPS 域名的静态 Vue 页面 → 同源 `/api/admin/`。联盟接口未来由 API 服务调用，浏览器和小程序不持有联盟密钥。

## 1. 开发机打包

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

上传项目源码、锁文件及构建产物时排除 `.env.local`、`.git`、`node_modules`、`.pnpm-store`、本地演示数据库、测试资料。Linux上安装对应平台依赖，不复制Windows的node_modules。

管理端 `apps/admin/dist` 部署到 `/var/www/cps/admin`。API及其production依赖部署在 `/opt/cps-platform`，例如在服务器使用同版本pnpm执行 `pnpm install --prod --frozen-lockfile`。本方案使用Node 24.15+的24.x版本。

## 2. 配置服务器

- 创建独立低权限运行用户 `cps`，使其拥有 `/var/lib/cps` 用于数据库。
- 运行时 API、Nginx 使用一个实例。管理端不要在生产运行Vite开发服务器。
- 以root创建 `/etc/cps-platform.env`，权限600，填入真实值：

```dotenv
NODE_ENV=production
DEMO_MODE=false
HOST=127.0.0.1
PORT=3018
DATABASE_PATH=/var/lib/cps/cps.sqlite
PUBLIC_ORIGIN=https://你的实际域名
SITE_NAME=你经审核的小程序名称
ADMIN_USERNAME=你设置的账号
ADMIN_PASSWORD=你独立设置的强密码
SUPPORT_WECHAT=真实客服号
```

生产启动校验 HTTPS origin 和关闭演示模式。首次会按环境变量初始化管理员，后续不会自动覆盖密码。

## 3. 配置域名与HTTPS

使用自己实际控制的域名和有效证书，核实该域名的网站备案要求；小程序备案不能自动代替服务端域名的网站备案。

修改 `deploy/nginx.conf.example` 中的域名、证书路径和静态目录，先 `nginx -t` 再加载。安全组只开放必要的80/443，SSH限制来源。API端口3018和数据库不直接暴露公网。

将 `deploy/cps-api.service.example` 调整为实际Node可执行文件路径，安装为systemd服务，查看日志与健康检查。样例限制Node堆384MB、服务内存768MB，是初始保护设置，不是性能承诺。

## 4. 微信配置

- 在 `apps/miniprogram/config.js` 填 `https://你的实际域名`。
- 在开发者工具项目配置中填自己的真实 AppID。
- 微信后台登记对应的 request 合法域名；后续若有下载/上传资源，再登记相应域名。
- 检查名称、类目、备案信息、隐私保护指引、目标小程序跳转权限。
- 关闭开发者工具的域名校验跳过项，使用真机测试。

## 5. 发布前验收

1. 未登录不能读取后台资源，退出后会话失效。
2. 小程序无真实优惠时显示空状态，不显示演示券。
3. 通过真实官方目标跳转，原平台付款，订单归属可在联盟后台验证。
4. 下架后不可继续领取；接口失败有明确提示。
5. 退款/失效订单不计入已结算记录佣金，重复导入不重复计数。
6. 生产数据备份和恢复演练完成，再扩大推广。

## 运维

使用 `pnpm backup` 或编译后的 `dist/backup.js` 在生产环境执行一致性快照，复制到独立存储并设置保留策略。监测进程RSS、CPU、磁盘空间、接口响应时间、数据库锁等待。不要以进程启动成功推断2GB内存可支撑特定用户规模。
