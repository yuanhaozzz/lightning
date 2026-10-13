# 雷电监测设备示意建模与布点

本阶段仅新增闪电定位仪和低误报雷暴预警仪各一台。沿用原安全监测区两处 X/Z 预留点；既有建筑、道路、围墙、区域划分和默认鸟瞰相机保持不变。

## 模型与数据

| 设备 ID | 示意结构 | 世界坐标（米，Y 向上） | GLB | 三角面 / 体积 |
| --- | --- | --- | --- | --- |
| `lightning-location-01` | 圆顶传感罩、单立杆、法兰、锚栓、密封设备箱、门缝/铰链/锁、保护线缆、混凝土基础 | `[-56, 0.014, 37]` | `public/models/mine-lightning-locator.glb` | 1,876 / 166,772 字节 |
| `storm-warning-01` | 下向传感头、连续弯臂、抱箍、三脚支架及撑杆、设备箱、连接线、基础 | `[-45, 0.014, 37]` | `public/models/mine-storm-warning.glb` | 3,516 / 250,840 字节 |

参考用户照片的外部安装形式，并核对公开工业传感器资料：[Vaisala 闪电探测传感器](https://www.vaisala.com/en/products/systems/lightning/single-point-sensors)、[Campbell CS110 电场传感器](https://us.campbellsci.com/cs110)。未复刻品牌、产品内部结构或精确尺寸，没有使用参考图片作贴图。图中结构均为通用示意；“低误报”是用户指定的设备类别名称，未实现或验证误报率。单台演示设备不表示完整闪电定位网络。

共享配置：`scripts/blender/monitoring.parameters.json`。每台包含 `id/name/type/position/rotation/modelPath/status/schematic/monitoringData`。`status=simulated-online`、`monitoringData.source=mock`；模拟闪电计数为 3、模拟电场值为 0.7 kV/m，其余实测时间、位置、误报率字段为空，不接入接口、不触发告警。尺寸可通过 `models` 参数调整。

两个 GLB 都以基础底部为局部原点，以米为单位，统一导出 Y 向上。场景实例负责位置、旋转和唯一 ID，不把实例 ID 固化进 GLB；同一类型的模型可复用，多个实例共享几何和材质。

## 操作

- 点击模型主体：选择独立设备 ID、显示暖色细线轮廓，约 1.25 秒平滑定位到近景。
- 两个简洁近景按钮用于从全景快速找到小型设备；选择状态仅显示名称、ID 和“示意 / 模拟数据”。
- 旋转、缩放、平移继续可用，手动操作中断飞行；“恢复鸟瞰”清除监测设备选择并恢复既有全景构图。
- 设备近景允许最短 2 米操作距离；回到全景/电力区时恢复原 25 米限制。不同宽高比按模型实际边界适配。没有数据面板、雷暴特效和告警联动。

## 生成与验证

```powershell
& 'D:\blender-5.2.2-windows-x64\blender-5.2.2-windows-x64\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_monitoring_devices.py
node scripts/blender/verify_monitoring_devices.mjs
node scripts/blender/verify_power_area.mjs
node src/features/mine-digital-twin/layout.check.mjs
npm.cmd run build
```

均已实际执行通过。Blender 5.2.2 导出日志无 WARNING/ERROR；共 5,392 三角面、417,612 字节（约 408 KiB），每个模型 6 个材质批次。资源自包含，检查 GLB 结构、有限顶点、单位法线、UV、PBR 参数和示意元数据。

20 个既有模型/建模脚本/布局环境文件通过保护哈希检查。使用真实导出几何的世界包围盒，基础最低面与原监测区地坪 `Y=0.014` 相接；至最近道路边界分别约 4.3 / 6.8 米，至园区围墙约 16.3 / 17.8 米，未与既有建筑及生产连接模型包围盒相交，也未与树木、路灯占地相交。该范围是三维演示占地验证，不代表真实设备的干扰、视野或工程布设评估。

实际 Three.js 射线验证两台设备独立选择、遮挡阻止选择和同类型资源克隆复用。近景边界验证覆盖 `604×871`、`1440×900`、`390×844`。浏览器实际点击两个模型主体、切换近景、操作 OrbitControls、恢复全景；无警告或错误。

浏览器有标识的三个 32 帧 CPU 渲染提交及标签处理样本，中位数约 1.7 / 1.5 / 1.1 ms，P95 约 2.1 / 2.7 / 1.8 ms；各样本包含不同相机位置，不能视作 GPU FPS。全景初始记录 213 次绘制、279,818 三角面，仍为空闲按需渲染。已有其他业务包的构建体积警告未在本阶段处理。

截图：`tmp/mine-lightning-locator-closeup.jpg`、`tmp/mine-storm-warning-closeup.jpg`、`tmp/mine-monitoring-overview.jpg`。报告：`public/models/mine-monitoring.report.json`、`mine-monitoring.verification.json`；浏览器验证与日志见 `tmp/mine-monitoring-browser-check.json`、`tmp/mine-monitoring-browser-log.json`。

原电力区桥架吊杆上端连接间隙保持原状，见 `POWER_ACCEPTANCE.md`，本阶段未修复或修改该模型。新增监测设备没有发现阻断加载、选中或布点展示的问题。到此停止，等待验收。
