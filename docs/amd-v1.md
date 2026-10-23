# AMD Ryzen 品牌展示页 V1.2

本地新增路由 `/amd`，沿用 Vite 的 `/map/` 基路径，实际地址为 `/map/amd`。独立品牌概念设计，非 AMD 官方网站。

## 开发与构建

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5188 --strictPort
pnpm type-check
pnpm build-only --outDir dist/amd-check
pnpm preview --host 127.0.0.1 --port 5190 --strictPort --outDir dist/amd-check
```

开发地址为 `http://127.0.0.1:5188/map/amd`；展示与验收使用生产预览 `http://127.0.0.1:5190/map/amd`，不含开发工具栏。独立构建目录用于验收，避免覆盖仓库原有 `dist/map`；正常发布仍可使用项目既有构建命令。静态服务需将 `/map/*` 页面请求回退到 `/map/index.html`。这些地址仅为本地预览。

## 实现

- `src/features/amd/index.vue`：页面、锚点导航、移动导航、场景选项卡和原生对比弹窗。
- `src/features/amd/ProcessorScene.vue`：Three.js 程序化处理器、主板、电路、粒子、指针倾斜与能量效果。无需下载模型或图片。
- `src/features/amd/AsyncProcessorScene.vue`：保留首帧绘制机会后独立加载三维模块，加载时显示纯 CSS 处理器，失败时保留说明。
- `src/features/amd/ArchitectureStory.vue`：三章节结构叙事，桌面原生滚动驱动金属顶盖展开与核心聚焦，手机和矮屏使用点选章节，无滚动锁定。
- `src/features/amd/ExperienceVisual.vue`：游戏山谷、三维创作视口、代码编辑器三种 SVG/CSS 场景，无新增 WebGL 实例。
- `src/features/amd/ProductFinder.vue`：按使用方向突出对应产品，原生单选组支持键盘操作，链接跳转到对应卡片，查看全部恢复默认状态。
- `src/features/amd/fonts.css` 与 `public/fonts/amd/`：本地字体与 OFL 授权、来源及哈希记录。
- `src/features/amd/style.css`：通过 Vue scoped 样式隔离，覆盖桌面、平板、手机。页面进入时切换独立 body 类，离开时恢复。
- `src/router/index.ts` 与 `src/RouteApp.vue`：延迟加载独立页面；直接进入 AMD 页面不会加载旧仪表盘和 Cesium。

三维场景限制像素比，离屏或标签页隐藏时暂停，遵循减少动画偏好。WebGL 不可用时显示静态处理器；临时上下文丢失后支持恢复；卸载时释放 GPU 资源与观察器。

产品支持选择 0–3 款对比，0 款时禁用按钮。对比表支持手机横向滚动、Escape 关闭和关闭后恢复焦点。场景选项卡支持左右箭头、Home、End。

Barlow / Barlow Condensed 的 9 个 Latin WOFF2 字体已本地化（共约 197 KiB，display=swap），不再请求 Google Fonts。中文使用系统字体。新增独立概念图标，离开 AMD 路由时恢复原图标。页面内容、字体、三维资源和交互均在本地；前往 AMD 的链接会打开外部官方页面。

V1.1 金属表面增加程序化粗糙度与微细凹凸，分层视图使用两个计算芯片及 I/O 模块的概念模型。桌面章节位置固定时继续使用原生页面滚动，不拦截滚轮。结构场景接近视口后才创建，离屏暂停渲染；减少动画模式按章节立即显示，手机章节切换保持滚动位置。WebGL 不可用时保留静态处理器和章节内容。

V1.2 提高正文、规格和按钮字号及对比度，桌面架构章节额外滚动行程缩短至 700px；清理页面内的调试风格标签，保留页脚的独立作品属性和规格说明。新增用途选择与对应卡片提示，推荐理由仅引用产品配置，不使用未经测量的性能结论。三维模块与页面正文拆分为独立构建资源，页面先呈现文字和基础视觉，再初始化场景。

## 规格来源

- [AMD Ryzen 9 9950X](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html)：16 核 / 32 线程，最高 5.7 GHz，L2 + L3 缓存 80 MB，默认 TDP 170 W。
- [AMD Ryzen 7 9700X](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9700x.html)：8 核 / 16 线程，最高 5.5 GHz，缓存 40 MB，默认 TDP 65 W。
- [AMD Ryzen 5 9600X](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-5-9600x.html)：6 核 / 12 线程，最高 5.4 GHz，缓存 38 MB，默认 TDP 65 W。

页面没有实测性能图表。能量效果、芯片结构与使用场景均是设计示意，不能用于推断真实性能或实体芯片布局。

## 浏览器验收

`scripts/amd-browser-check.mjs` 使用 Playwright 与本机 Edge。可通过 `PLAYWRIGHT_MODULE` 指向已有的 Playwright ESM 文件；`AMD_BROWSER_CHANNEL` 可切换浏览器通道，`AMD_URL` 可指定验收地址，生产验收设置 `AMD_PRODUCTION=1`。无需将测试工具加入生产依赖。

验收覆盖：独立路由资源、生产构建无开发客户端、本地字体、WebGL 渲染、能量效果、临时上下文恢复、固定滚动章节与键盘往返、手机无固定滚动章节、三种应用场景、用途选择和卡片定位、三款/空选/单款对比、弹窗焦点与滚动恢复、1920/1024/768/390/360 宽度、移动菜单 Escape 回焦、减少动画偏好及 WebGL 禁用降级。结果与截图输出至 `tmp/amd-acceptance/`。

普通视口截图用于检查 WebGL 首屏；长截图用于检查页面结构（浏览器拼接长图时可能清空 WebGL 缓冲区）。

## 性能记录（2026-10-23）

`scripts/amd-performance.mjs` 使用同一个生产预览地址，通过 `AMD_PERF_LABEL=baseline` 或 `final` 保存数据到 `tmp/amd-performance/`。与验收脚本相同，可用 `PLAYWRIGHT_MODULE` 指定工具链中的 Playwright。

本机无头 Microsoft Edge 冷 HTTP 缓存单次采样：桌面为 1440×1000 / DPR 1；移动布局为 390×844 / DPR 2，通过 CDP 模拟 4 倍 CPU 减速、1.6 Mbps 下载带宽及 150 ms 网络延迟。FCP / LCP、CLS 和长任务来自 PerformanceObserver；场景就绪为组件发出的 ready 状态；传输量来自 CDP。显卡为 Intel UHD / ANGLE D3D11。

| 指标 | 优化前 | V1.2 |
| --- | ---: | ---: |
| 桌面首次内容绘制（FCP） | 1,724 ms | 388 ms |
| 移动模拟首次内容绘制（FCP） | 5,948 ms | 1,664 ms |
| 桌面场景就绪 | 1,592 ms | 1,737 ms |
| 移动模拟场景就绪 | 4,011 ms | 7,358 ms |
| 移动模拟布局偏移（CLS） | 0 | 0.00466 |
| 全部加载 JS 压缩体积 | 214,787 B | 216,537 B |

这次优化让文字和操作入口提前呈现，没有加快 GPU 初始化，也没有减少全部加载后的总体积。三维模块后置，因此移动模拟场景就绪更晚；rAF 回调间隔没有一致改善，不能宣称帧率提升。两种配置最终均无页面异常或请求失败。LCP 候选是装饰文字而非 WebGL 画布；rAF 采样也不等于 GPU 渲染帧率。上述结果会受系统负载及缓存波动影响，不代表真实手机、Lighthouse 评分或线上 Core Web Vitals。
