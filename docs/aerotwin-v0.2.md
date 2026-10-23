# AEROTWIN V0.2 — 机位校准与单车保障作业

在原有 V0.1 独立路由上迭代，实际地址为 **`/map/aerotwin`**。`/map/` 来自仓库既有 Vite base；本页面不初始化原有 Cesium 场景。机位 A21、航班 DEMO-320 和 BAG-001 均为演示数据。没有后端或现场数据接口。

## 启动、构建和复现

使用符合仓库 engines 的 Node.js `^22.18.0 || >=24.12.0`（本次实际 22.22.1）及 pnpm。仓库依赖与锁文件沿用原版本，本轮未新增运行时依赖。

```powershell
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5176
```

打开 `http://127.0.0.1:5176/map/aerotwin`。生产验收使用单独目录：

```powershell
pnpm run type-check
pnpm run build-only --outDir dist/aerotwin-v02-check
pnpm run preview --outDir dist/aerotwin-v02-check --host 127.0.0.1 --port 4176
```

生产预览为 `http://127.0.0.1:4176/map/aerotwin`。原 `pnpm build` 仍输出 `dist/map`。静态托管应将 `/map/*` 页面请求回退到 `index.html`，并保留 `/map/models/airport/` 的实际文件。

本机工具：pnpm 10.17.1、Vue 3.5.43、Vue Router 5.3.1、TypeScript 6.0.3、Vite 8.3.1、Three.js 0.186.1、@types/three 0.186.0、Blender 5.2.2 LTS。Playwright 1.62.1 与 Edge 155.0.4283.45 仅用于验收；录屏所需 FFmpeg 1011 下载至项目 `tmp/airport-playwright/`，没有修改产品依赖或系统配置。

```powershell
node scripts/airport-assets-check.mjs
node scripts/airport-vehicle-assets-check.mjs
node scripts/airport-simulation-check.mjs
$env:AEROTWIN_URL='http://127.0.0.1:4176/map/aerotwin'
node scripts/airport-v02-browser-check.mjs
```

浏览器脚本默认使用本机已有 Playwright/Edge 路径，其他机器可设置 `AEROTWIN_PLAYWRIGHT_MODULE`、`AEROTWIN_BROWSER_PATH`、`PLAYWRIGHT_BROWSERS_PATH`。录制需要在对应缓存目录安装 Playwright FFmpeg；`AEROTWIN_FFMPEG` 仅用于指定录制完成后的裁切程序，不替代 Playwright 自身的录制依赖。仿真脚本使用仓库 TypeScript 在内存中转译，无需额外编译工具。

本次三轮与原生后台验证分开执行：`node scripts/airport-v02-browser-check.mjs --skip-native` 和 `node scripts/airport-v02-browser-check.mjs --visibility-only`。后者默认保存至 `tmp/airport-v02-native-visibility.json`，交付副本保留在 `docs/`；默认不传参数则依次执行两者。1920性能脚本为 `node scripts/airport-v02-performance.mjs`。

## 布局与材质

第一阶段先输出 `screenshots/v0.2/01-layout-calibrated-1920.png`，当时尚未接入任务 UI。它是浏览器截图，记录布局校准完成时的状态；最终作业截图另行保存。

飞机维持长37.57、翼展35.80、高11.76、机身宽3.95米。世界 +Y 向上、+Z 机头、+X 左舷；右前货舱在 −X。主航站楼移至左舷侧，幕墙约X24米；廊桥固定入口连接新幕墙，伸缩段继续对准L1，飞机与登机桥均静止。总览从右前方无遮挡位置看飞机，作业镜头覆盖整个往返路径，不自动追车。完整模型保留，没有隐藏屋顶、透明机身或缩小飞机。

基础材质分别处理喷漆、金属唇口、橡胶、玻璃与混凝土；驾驶舱角点和机鼻轮廓修整。机坪两张原创1K纹理提供柔和色斑与粗糙度，板块采用不同乘色系数。天空和环境反射来自同一程序白天天空，远景雾色与天空按当前Three版本的色彩处理顺序衔接；没有照片背景、泛光或天气效果。

## 单车任务与时间

顶部“保障作业”只切换面板模式；场景、任务、相机和模型实例保持不变。BAG-001 控制 BT-01 行李牵引车与第一节拖车，第二节拖车与飞机牵引车静态待命。

`idle → to_service → servicing → returning → completed` 与 `stopped/running/paused/error` 分开维护。`simulation.ts` 是唯一仿真状态，DOM读取快照；每帧由唯一渲染循环传入时间戳差值，再以1/120秒子步积分。界面更新时间限流不改变仿真时间。没有独立推进数字的定时器、随机任务数据或烘焙动画。

行驶进度按本段弧长，交接进度按6秒可配置模拟时间。到位同时检查后轴位置、车头朝向、速度，再开始计时。交接只代表模拟驻留，不代表装机完成。车轮按真实累计行驶距离/轮半径滚动，前轮有限速率转向；拖车使用牵引杆与前轴回转架的二维运动学，两个连接长度每步约束，车厢转弯自然滞后。

固定路线由连续切向的直线与圆弧组成，最小半径6米。去程约61.85米、回程约31.85米，合计93.694686米；最高3m/s、加速0.8m/s²、减速1.1m/s²、弯道侧向加速度上限0.65m/s²。默认一轮仿真49.05秒，暂停不计入。均为演示参数，不是机场作业标准。

资源绑定和局部坐标先验证；任务开始前对平滑后的实际运动轨迹执行整组扫掠，覆盖车体、拖车、前轮回转范围和牵引杆，也检查两个车体互碰。无效配置会显示节点或障碍名称，不回退为直线路径。

离开前台会自动暂停；返回后需要手动继续，不补算后台时间。相机拖动可打断镜头过渡但不暂停任务。任务重置清空日志与时间并恢复初始车辆姿态；“视角复位”只复位镜头。完成后不自动循环。

## 配置与可编辑资产

- `src/config/airport.ts`：五类模型、单位、自然光、相机与交互边界。
- `src/config/airportTask.ts`：业务ID、后轴停车姿态、交接停车姿态、去回路线、几何、仿真参数和保守障碍包络。
- `src/config/airportAssetBindings.ts`：业务模型节点、局部连接点与实测轮径。
- `src/three/airport/simulation.ts`：状态机、弧长运动、拖车运动学及扫掠校验。
- `src/three/airport/vehicleAdapter.ts`：绑定真实GLB节点，将唯一状态映射到车体、转向、轮滚转与回转架。
- `assets/blender/aerotwin-v0.2.blend`：当前可编辑源；V0.1源保留作历史。
- `assets/blender/vehicle-interface.json`：实际Blender节点测量和轴心约定。
- `public/models/airport/manifest.json`：当前导出版本、五个GLB实际字节数及根节点。

重新生成：`blender --background --python assets/blender/generate.py`。脚本只更新本项目具名生成集合，保留无关对象；米制→GLB +Y向上只转换一次。纹理打包在`.blend`和`apron.glb`中。详情见[模型说明](airport-models.md)、[来源与许可](airport-resources.md)、[开始前审计](aerotwin-v0.2-audit.md)。

开发调试访问 `/map/aerotwin?debug=1` 显示实际路线、凸包障碍、车辆轮廓、牵引杆与停车锚点。默认关闭。调试轮廓和验收使用相同的几何函数。

## 当前简化与范围

仍是可继续打磨的基础资产：细贴图、机体曲面/机翼缝线和车辆机械细节未到照片级。驾驶舱与货舱外形为原创近似，货舱只有关闭状态外观与参考锚点；交接停车点位于其外侧，与货舱门中心分开，不模拟传送带、开门或逐件装卸。飞机、风扇、登机桥和其他设备不运动。

车辆是简化二维运动学；同轴左右轮采用共同累计轴心行程，未模拟差速、悬挂或轮胎弹性。固定路线连续位置与切向，直线/圆弧交界的曲率变化由有限转向速率表现，不宣称工业车辆动力学。碰撞包络是本原创场景的保守平面校验，不是真实机场安全间距认证。

没有多车调度、飞行动画、夜景、复杂天气、历史回放、登录后台或真实数据。运行回放保留明确禁用态。本轮到V0.2停止。

## 参考

[Airbus A320 Airport and Maintenance Planning](https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-01/AC_A320_0624.pdf)用于尺寸和典型布局关系；[Three.js MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)用于PBR与环境照明；[Three.js Curve](https://threejs.org/docs/pages/Curve.html)用于弧长路径接口参考，本实现采用精确圆弧/直线参数；[MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)用于统一时间戳与后台行为设计。

浏览器验收证据、录屏、性能和未通过项以 [V0.2验收记录](airport-v0.2-acceptance.md) 为准，不将离线数值测试帧率当作网页FPS。
