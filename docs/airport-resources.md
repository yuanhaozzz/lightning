# AEROTWIN 资源来源与许可记录（V0.2，保留 V0.1 历史）

记录日期：2026-10-14。当前公开模型资产版本为 `0.2.0`。该记录仅覆盖新增 AEROTWIN 机场场景，不代表当前仓库其他页面、旧模型或地图资源的许可情况。V0.1 源文件与截图保留，不把旧版本截图当成 V0.2 当前效果。

## 本轮交付资源

| 资源 | 来源 / 制作方式 | 作者 / 提供者 | 许可与使用记录 |
| --- | --- | --- | --- |
| 飞机几何 `public/models/airport/aircraft.glb` | 本项目 `assets/blender/aircraft.py` 程序化原创建模，在 Blender 实际导出 | 本次 AEROTWIN 开发制作 | 未导入第三方模型文件；没有真实航司标识。机型名称与公开尺寸仅作外形参考，不表示 Airbus 授权或认证 |
| 航站楼、廊桥、机坪、保障车辆 GLB | 本项目 `assets/blender/environment.py` 程序化原创建模，在 Blender 实际导出 | 本次 AEROTWIN 开发制作 | 未导入第三方机场模型、车辆模型或扫描资产；航站楼为原创场景，A21 为演示机位 |
| 材质 | Blender Principled BSDF 基础颜色、粗糙度与金属度；喷漆、玻璃、混凝土、金属、橡胶分别设置 | 本次 AEROTWIN 开发制作 | 未使用下载贴图、付费材质、来源不明图片或 HDRI 文件 |
| 混凝土细颗粒贴图 `AT_Concrete_Original_Grain_1K` | `environment.py` 使用固定随机种子生成 1024 × 1024 颗粒及低频色斑，打包进 `.blend` 并嵌入机坪 GLB | 本次 AEROTWIN 开发制作 | 原创程序纹理；没有外部下载来源，不需要访问纹理服务器 |
| 混凝土粗糙度贴图 `AT_Concrete_Original_Roughness_1K` | V0.2 由同一脚本生成 1024 × 1024 柔和磨损 / 粗糙度变化，打包进 `.blend` 并由导出器嵌入 GLB 材质通道 | 本次 AEROTWIN 开发制作 | 原创程序纹理，无外部图片、付费材质或网络依赖 |
| 车辆运动接口与飞机 reference anchor | V0.2 在本项目原始几何上修复 root、Steer、Roll、FrontBogie、Drawbar 与 hitch 节点；增加 L1 / 前货舱参考点 | 本次 AEROTWIN 开发制作 | 原创场景接口；不是来自厂商的机械 CAD、真实机场作业接口或认证数据 |
| 标牌与地面 A21 字样 | Blender 内置默认字体产生的几何字形，导出为网格 | 字形来自 Blender 内置字体；排布由本项目制作 | 不分发外部字体文件，不宣称字体字形为项目原创；GLB 内保存转换后的几何 |
| 1 米标定场景 | `assets/blender/calibrate.py` 原创测试立方体、坐标轴、接收阴影平面 | 本次 AEROTWIN 开发制作 | 与正式场景分开保存，用于尺寸和导出方向核对 |
| 首页概念图 | 用户在本次会话提供的 `codex-clipboard-667663e5-adc1-4110-993c-28787b2cef70.png` | 用户提供；原始作者未另行声明 | 仅作为视觉、构图和 UI 参考。没有作为三维场景背景、贴图或工程图嵌入交付模型，也未将其列为可独立再分发的项目资产 |

本次交付没有需要另购、待下载或许可不明的外部模型 / 贴图依赖。仓库未因本轮制作而新增一种整体开源许可证；项目所有者发布源码及生成资产时，应自行明确项目分发许可。第三方运行库继续遵循各自软件包附带的许可证。

## 公开资料

1. [Airbus A320neo 官方产品页面](https://www.aircraft.airbus.com/en/aircraft/a320-family/a320neo)，2026-10-14 查阅。公开外形尺寸：机长 37.57 m、几何翼展 35.80 m、机高 11.76 m、机身宽度 3.95 m。该页面是尺寸依据，不是本模型的工程曲面或制造图纸来源。未下载、复制或打包页面照片。
2. [Three.js GLTFLoader 官方文档](https://threejs.org/docs/pages/GLTFLoader.html)，2026-10-14 查阅。用于 glTF 2.0 模型加载与资源生命周期的实现参考；没有将其示例模型打包到项目。

## 保留的可编辑源文件

- `assets/blender/aerotwin-v0.2.blend`：当前五类正式资产、修复后的车辆节点和两张打包纹理。
- `assets/blender/aerotwin-v0.1.blend`：V0.1 历史静态场景源文件。
- `assets/blender/calibration.blend`：1 米标定源文件。
- `assets/blender/common.py`：米制坐标转换、材质、网格、独立资产集合与 GLB 导出工具。
- `assets/blender/aircraft.py`：A320neo 外观飞机的生成脚本。
- `assets/blender/environment.py`：航站楼、廊桥、机坪、车辆的生成脚本。
- `assets/blender/calibrate.py`、`assets/blender/generate.py`：标定与正式导出入口。
- `public/models/airport/manifest.json`：实际导出版本、文件字节数、资源根节点与对象数。
- `assets/blender/vehicle-interface.json`：V0.2 实际节点、局部轴心、初始世界姿态、尺寸、连接点和 Blender 构建验证值。
- `scripts/airport-vehicle-assets-check.mjs` 与 `docs/airport-v02-vehicle-assets.json`：实际导出 GLB 的 Node / GLTFLoader 接口验证脚本与结果。

V0.2 使用两张原创 1K 程序混凝土纹理，保存在当前 `.blend` 的打包图片中，并经 GLB 材质导出内嵌；生成代码随项目提交。无需外部纹理目录或网络取图。几何标线、窗户、驾驶舱窗、折棚与车辆零件仍为真实网格或基础材质细节。V0.1 的较早材质状态保存在历史 `.blend` 中。

## 证据性质

`docs/screenshots/v0.1/` 保存 V0.1 实际浏览器截图；V0.2 截图和性能由相应版本验收记录管理。模型源文件、GLB 和脚本本身不构成浏览器视觉或性能验收结论。`airport-v02-vehicle-assets.json` 来自实际 GLB 的解析、世界顶点测量与内存试姿态，不是离线渲染，也不代替浏览器任务交互验收。概念图、Blender 离线图和浏览器截图必须分别标注。
