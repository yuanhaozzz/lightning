# 电力保障区精细化交付

仅替换变电站和配电室。`layout.ts`、`overviewCamera.ts`、环境、道路、其他区域脚本与所有既有 GLB 的 18 项文件哈希保存在 `scripts/blender/power_area.protected-baseline.json`，生成前后及独立验证均复核。新资源通过 `powerModels.ts` 叠加加载，固定比例 1、原点不变。没有创建项目、路由或业务数据面板。

## 结构与资源

变电站仍锚定 `[52,0,-26]`，占地 18×12 米。原 3 米高体块改为开放设备场，最高母线支撑约 5.46 米，既有鸟瞰构图包络仍能覆盖。配电室仍锚定 `[53,0,-10]`，主体 18×9 米，屋脊 4.5 米。

| GLB | 内容 | 三角面 | 材质数 | 文件字节 |
| --- | --- | ---: | ---: | ---: |
| `mine-substation.glb` | 变压器油箱、连接散热片与油管、储油柜、HV/LV 陶瓷套管、三相母线、隔离开关、断路器、基础、围栏和西侧检修入口 | 25,784 | 11 | 1,509,588 |
| `mine-distribution-shell.glb` | 有真实门窗开口的墙体、立柱、开启双门、百叶通风及地坪 | 3,108 | 8 | 560,484 |
| `mine-distribution-roof.glb` | 独立双坡屋顶、站缝、封闭山墙、檩架和排水构件 | 2,548 | 4 | 375,184 |
| `mine-distribution-equipment.glb` | 12 个独立配电柜、梯式桥架、护套电缆、接地端子与安装预留 | 6,152 | 7 | 617,996 |

合计 **37,592 三角面、3,063,252 字节（3.06 MB）**，106 个材质网格。材质采用与现有模型相同的灰绿工业金属、混凝土、深色屋面，并区分陶瓷、铜排与护套电缆。局部噪声 PBR 图像打包在 GLB 中；参考图片不被读取或作为贴图。仅按同一实体、同一材质合并网格，避免设备 ID 丢失。

结构参考：[Hitachi Energy 变压器套管](https://www.hitachienergy.com/products-and-solutions/insulation-and-components/transformer-insulation-components/transformer-bushings)、[Schneider Electric SM6 安装资料](https://www.se.com/ca/en/download/document/NVE7176401/)。照片仅用于识别部件结构；设备规模适配既有地块，没有照搬照片布局或额外避雷针。

## 屋顶及设备交互

点击页面“隐藏配电室屋顶”，屋顶与其椽架单独隐藏，墙体、立柱、柜体、桥架保持显示。再次点击恢复屋顶并更新静态阴影。已有旋转、缩放、平移及“恢复鸟瞰”保持原逻辑；默认相机参数与模块未改变。

短距离主键点击进行射线选中，显示边框与名称/ID 一行。拖动、长按和右键保持原相机操作。射线先检查全场景遮挡，不能隔着墙或屋顶选中隐藏柜体。打开屋顶后，柜体仍不能穿墙选中。重盖屋顶会清除室内选中状态。对象卸载时清理监听器、选中边框及资源。

| 独立 ID | 用途 |
| --- | --- |
| `power-cabinet-mv-01` 至 `06` | 高压配电柜 |
| `power-cabinet-lv-01` 至 `06` | 低压配电柜 |
| `spd-distribution` | 低压进线柜 `power-cabinet-lv-01` 前部空安装板，沿用既有预留 ID；替代原顶部体块标识 |
| `grounding-test-point-01` | 西侧室外接地装置示意检修盖板 |
| `grounding-monitor-reserve-01` | 西侧外墙空安装支架，没有生成在线监测仪 |
| `grounding-downlead-interface-01` | 外墙接地引下线测试接口 |

各实体的 `id/name/kind/position/size/parentId`（有则写入）通过 glTF extras 保留在 Three.js `userData` 中，`powerInteraction.ts` 提供注册、射线选中、屋顶显隐与释放接口，供后续查看内部设备复用。预留位置使用名称标识，遵循现有全局标识开关。仅显示局部接地连接与接口，没有地下接地网或电阻监测业务。

## 生成及检查

```powershell
& 'D:\blender-5.2.2-windows-x64\blender-5.2.2-windows-x64\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_power_area.py
node scripts/blender/verify_power_area.mjs
node src/features/mine-digital-twin/layout.check.mjs
node scripts/blender/verify_core_production.mjs
npm.cmd run build
```

参数在 `scripts/blender/power_area.parameters.json`：既有锚点/占地、母线与构架标高、配电室屋顶标高、柜体尺寸/排数/间距，以及所有安装预留的 ID、尺寸和位置。支持 `-- --parameters 文件 --output-dir 目录`。固定既有布局的参数不能随意调整，以免破坏地块保护校验。

实际运行 Blender 5.2.2 LTS，最终导出无 WARNING/ERROR。验证包括 GLB 二进制结构、自包含图像、有限顶点/单位法线/UV、PBR 参数、唯一实体 ID、资源预算与保护哈希。使用实际导出几何及 Three.js 射线验证全部 12 个配电柜和 4 个预留的独立选中，并验证全部柜体在屋顶显示时被遮挡。柜体间无包围盒重叠，接地预留不占道路；两排柜体含把手的实际前方净距约 2.70 米，背侧检修空间约 1.72 米，桥架与柜顶接口之间约 0.33 米。

变电站裸导体与构架、油箱、储油柜、散热片及接地设备外壳的实际三角面距离采样 **113,568 次**，最小表面净距约 **0.547 米**，未发现穿插；接线端子处的必要连接接触排除。该检查针对可视化结构与关键路径，并非全体零件的穷举碰撞或电气额定安全间距认证。

输出报告：`public/models/mine-power-area.report.json`、`mine-power-area.verification.json`。历史煤运校验在修改页面前通过；该历史脚本锁定旧 `index.vue` 哈希，本轮新增屋顶/选中功能后由新的电力区保护清单验证煤运 GLB 和脚本保持不变。

浏览器实测及截图见 `tmp/mine-power-browser-log.json`、`tmp/mine-power-performance.json`、`tmp/mine-power-closeup.jpg`、`tmp/mine-power-interior.jpg`、`tmp/mine-power-overview.jpg`。CPU 提交与标识排版采样不能换算成 GPU FPS；首轮编译、加载与缓存热身开销应与稳定交互分别查看。构建仅有原项目其他大包的既有体积警告。

最终页面加载 12 个 GLB，注册 16 个可选中电力实体，没有浏览器警告或错误。604×871 像素实际视口中，保留名称标识，连续三个 32 帧样本的 CPU 渲染提交加标识排版中位数均约 **1.6 ms**，P95 分别约 **2.7 / 3.0 / 2.5 ms**；稳定鸟瞰提交约 **203 次绘制、274,462 三角面**，空闲按需渲染。此前一次加载初期样本约 17.8 / 48.2 ms，反映热身波动；不承诺硬件无关的 FPS。独立柜体增加了绘制分组，保持可选中能力，当前没有观察到持续明显交互卡顿。

本轮到此结束，没有开发管理区、监测设备或其他阶段。

后续只读验收发现桥架吊杆连接间隙；临时近景定位、截图及待修复项见 [POWER_ACCEPTANCE.md](./POWER_ACCEPTANCE.md)。原校验的通过结果不涵盖该连接缺陷。
