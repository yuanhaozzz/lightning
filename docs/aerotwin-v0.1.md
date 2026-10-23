# AEROTWIN V0.1 — A21 近机位

这是当前 Vue 项目中的独立页面，路由为 `/aerotwin`。仓库既有 Vite base 为 `/map/`，因此实际访问路径为 **`/map/aerotwin`**。本轮没有新增后端、登录、真实数据服务或飞机/车辆作业动画。

## 启动与构建

在仓库根目录执行，使用 Node.js 22.18+ 或现有 package.json 允许的较新版本：

```powershell
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5176
```

打开 `http://127.0.0.1:5176/map/aerotwin`。

```powershell
pnpm run type-check
pnpm run build
```

原项目构建命令输出至 `dist/map`。如需将这次验收产物放在单独目录，避免替换默认构建产物：

```powershell
pnpm run build-only --outDir dist/aerotwin-check
pnpm run preview --outDir dist/aerotwin-check --host 127.0.0.1 --port 4176
```

生产预览路径为 `http://127.0.0.1:4176/map/aerotwin`。静态托管需要将 `/map/*` 的页面路由回退到构建后的 `index.html`；模型路径使用 `import.meta.env.BASE_URL`。

## 本次实际使用的工具

| 工具 | 实际版本 |
| --- | --- |
| Node.js | 22.22.1 |
| pnpm | 10.17.1 |
| Vue | 3.5.43 |
| Vue Router | 5.3.1 |
| TypeScript | 6.0.3 |
| Vite | 8.3.1 |
| Three.js / @types/three | 0.186.1 / 0.186.0 |
| Blender | 5.2.2 LTS |
| 验收浏览器 | Microsoft Edge 155.0.4283.45，Playwright 1.62.1 驱动 |

沿用现有 `package.json` 和 `pnpm-lock.yaml` 的依赖，没有升级或新增运行时依赖。Playwright 使用本机已有工具环境，仅用于验收，没有加入产品依赖。本机默认 Node 20 不满足项目引擎约束，执行验收时显式使用了已安装的 Node 22.22.1。

## 代码和资产入口

- `src/RouteApp.vue`：根据已就绪路由选择独立机场页面或原页面入口；直接打开机场路由不会初始化原有 Cesium 业务场景。
- `src/pages/AirportOverview.vue`：页面生命周期、真实加载状态、错误重试、面板显隐。
- `src/components/airport/`：DOM 顶栏、航班面板、保障面板、工具栏和图标。
- `src/config/airport.ts`：米制坐标约定、模型清单、整体加载变换、相机预设与控制边界、日照参数。
- `src/three/airport/createAirportScene.ts`：Three.js 场景、GLB 加载、轨道相机、镜头过渡、渲染和资源释放。
- `assets/blender/`：正式与校准 `.blend` 文件，以及完整生成、导出脚本。详细模型布置参数位于这些脚本中。
- `public/models/airport/`：五个可替换正式 GLB、独立校准 GLB、实际资产清单。

左键拖动旋转，滚轮缩放，右键拖动有限平移。底部有总览、飞机、廊桥三个镜头；手动操作会中断正在进行的镜头过渡。复位恢复默认相机与观察目标。隐藏面板后仍保留顶部和底部，底部按钮变成“显示面板”。

## Blender 与标定

先运行 `assets/blender/calibrate.py`，在 `/map/aerotwin?calibration=1` 验证 1 米立方体、红 X / 绿 Y / 蓝 Z 方向和投影，再运行 `assets/blender/generate.py`。本轮已实际执行该顺序并保存校准截图与测量 JSON。

```powershell
blender --background --python assets/blender/calibrate.py
blender --background --python assets/blender/generate.py
```

本机使用的可执行文件为 `D:/blender-5.2.2-windows-x64/blender-5.2.2-windows-x64/blender.exe`。在其他设备上替换为当地 Blender 路径。脚本只替换 `AEROTWIN_*_v01` 生成集合；导出只选择相应集合，不清空其他用户对象。

## 验收及来源

- [验收记录](airport-acceptance.md)：实测设备、构建、尺寸、交互、性能与截图。
- [模型说明](airport-models.md)：节点、方向、门位与本轮简化内容。
- [资源来源](airport-resources.md)：原创资产、程序纹理和官方参考资料。
- `scripts/airport-browser-check.mjs`：可重复执行的浏览器验收。默认使用本机已有 Edge/Playwright；可通过 `AEROTWIN_BROWSER_PATH`、`AEROTWIN_PLAYWRIGHT_MODULE`（模块文件 URL）、`AEROTWIN_URL` 指定其他安装与预览地址。

```powershell
node scripts/airport-browser-check.mjs calibration
node scripts/airport-browser-check.mjs development
```

截图来自真实浏览器实时渲染，不是 Blender 离线渲染，也没有把参考概念图作为场景背景。本轮资产仍是基础形体、结构、光照和材质版本；局部工程曲面、精细机械、污损/PBR 贴图与照片级效果尚未完成。具体限制列于模型说明和验收记录。
