# 煤矿地面工业园区：场景视觉优化

页面沿用 `/mine-digital-twin`。井架、井口房、提升机房及生产连接设施加载已有 GLB。精细化煤仓、转载站和输送机见 [COAL_TRANSPORT.md](./COAL_TRANSPORT.md)。本轮已加入变电站、配电室和独立配电柜，支持屋顶隐藏与设备选中，详情见 [POWER_AREA.md](./POWER_AREA.md)；管理等区域继续保留占位模型。场地为 148 × 114 米，坐标单位为米，Three.js Y 轴向上，+Z 为南侧。以下保留上一轮视觉优化记录。

## 布局关系

- 中部：井架、井口房及提升机房。提升机房位于天轮轮平面方向，保留绳道空间。
- 西北：井口至转载站至两座煤仓的连续运输路径，跨内部道路的输送带底面高于 5.5 米。
- 东北：变电站、配电室，配独立维护支路。
- 南侧：办公楼、调度中心，靠近主入口。西侧煤运入口独立接入园区环路。
- 西南：两类监测设备的开阔预留地，远离东侧电力区域。
- 北侧及电力区域：避雷针位置预留。虚线表示接地通道预留；配电室 SPD 标识已落到室内进线柜安装板，调度中心屋顶预留标记保持原状。

地面提升机与顶部天轮的布置参考：[SIEMAG TECBERG 支撑结构](https://www.siemag-tecberg.com/en/products-and-services/shaft-hoisting-technology-mines-and-underground-storages/support-structures)。本阶段尺寸和间距用于检查空间关系，设备安装条件待型号确定后复核。

## 配置与后续替换

`layout.ts` 是空间布局来源。每个建筑/预留点都有 `id`、`name`、`type`、`position`、`size`、`rotation`、`modelPath` 和 `zone`。旋转为 XYZ 欧拉角（度），坐标是体块底面中心；`modelPath` 相对 Vite 公共资源根目录，不含开头斜线。

后续将精细模型放入 `public/models` 并填写对应 `modelPath`，加载器会替换该 ID 的体块，保持原坐标与旋转。默认将模型统一缩放到配置包围盒内，按底面中心对齐。已有井架使用固定 `modelScale: 1.6` 和原模型地坪标高 `modelGroundY: -0.59`；该缩放只发生在 Three.js 场景中，源 GLB 未改写。`groundOpening` 保存场地井口开孔。

井口房、提升机房使用 `preserveModelOrigin: true` 与固定比例 1；生产连接设施使用世界坐标原点。源文件位于 `scripts/blender/generate_core_production.py` 及同目录参数 JSON。本轮不执行模型再生成。

`parkScene.ts` 组装占位场景、道路并集、输送带和名称标识。道路交叉处只生成一层表面，避免共面闪烁。场景在控制、尺寸或模型变化时绘制，静止时复用画面与阴影。

## 本轮视觉调整

- `overviewCamera.ts` 用场地边界和建筑包围盒的实际投影计算距离，再将其居中于标题下方的可用画面。横屏俯视 40°，竖屏 44°；竖屏调整方位角，尺寸变化时重算默认构图。用户已移动相机时保留当前观察位置，可点恢复鸟瞰重新适配。
- `surfaceMaterials.ts` 生成本地 128 × 128 混凝土与沥青纹理，使用世界坐标 UV 保持地面比例一致。曝光 0.9，降低环境光，保留暖色主光和弱补光；3072² 静态阴影在模型加载时更新。
- `siteEnvironment.ts` 添加围墙、主入口和煤运入口的滑动门、道路边界与虚线、建筑地坪、电力区隔离网、设施预留点基础、14 棵小树和 12 盏路灯。门保持开启，围栏在原维护支路处留口，提升机房门前保留通行地坪。
- 环境构件按材质与几何体合并为 13 组实例，路灯只包含灯具几何，不增加动态光源。无新大型建筑、精细设备、业务面板或天气特效。

## 对比与检查记录

`tmp/mine-visual-before-same-view.jpg` 和 `tmp/mine-visual-after-same-view.jpg` 为 1280 × 720 的真实浏览器截图：相机、目标、俯视角和距离相同，仅切换视觉设置和环境构件。优化前构图另保存为 `tmp/mine-visual-before-default.jpg`；宽屏、竖屏和窄屏截图分别为 `mine-visual-wide.jpg`、`mine-visual-portrait.jpg`、`mine-visual-narrow.jpg`。

`tmp/mine-visual-geometry-check.json` 记录 1280×720、1366×768、1920×1080、604×871、390×844 的投影边界检查，以及树木、路灯中心避开道路和建筑、环境位于场地范围内的检查。窄竖屏为保证完整场地会有更多垂直余白，可正常缩放查看细节。

开发浏览器每组 32 次互动绘制采样：首次中位 14.8 ms、P95 38.1 ms；最终暖机后 CPU 绘制和标识处理中位 1.4 ms、P95 8.9 ms。完整记录为 `tmp/mine-visual-browser-log.json`。这不是 GPU 帧率测试，也不保证所有设备恒定 60 FPS。场景使用按需绘制，静止时不重复提交场景和阴影。浏览器已实际检查旋转、滚轮缩放、方向键平移、恢复鸟瞰及不同宽高比显示。

## 验证与查看

```powershell
node src/features/mine-digital-twin/layout.check.mjs
node scripts/blender/verify_core_production.mjs
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

打开 `http://127.0.0.1:5173/mine-digital-twin`。默认鸟瞰完整场地，左键旋转、滚轮缩放、右键/方向键平移；“恢复鸟瞰”清除惯性并恢复构图。“隐藏标识”可检查纯体块关系，狭窄视口优先显示区域标识，重叠文字自动避让隐藏。

几何检查涵盖唯一 ID、尺寸、建筑之间及建筑与道路之间的重叠、所有道路/步道到主入口的连通性、建筑通达性、输送带跨路净空及支撑位置。

构建与类型检查通过；原有其他业务块超过 500 kB 的构建提示仍存在，本轮不修改这些业务模块。完成视觉优化后停止，等待下一阶段指令。
