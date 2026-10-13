# 动态工厂第一阶段交付与验收

本轮仅实施动态设备与基础工艺模拟；未开始建筑分层下钻、柜门动画、扫描/爆炸图或自动巡检。既有天气演示保留，未优化天气视觉。

## 操作

在 `/mine-digital-twin` 底部点击 **工厂运行演示 → 启动工厂**。面板支持单设备运行、停止、模拟故障、恢复、机械速度调节及提升方向反转。故障恢复回到停止状态，需明确重新启动。

“定位并查看机械”沿用原相机飞行动画：提升机检修时仅隐藏可恢复的屋面；输送机暂时隐藏相应罩盖；煤仓可局部剖视煤体和料位。查找对象可独立定位天轮、滚筒、两个导向轮、提升容器以及三段输送设备。恢复鸟瞰还原检修显隐、屋顶和选中状态，不擅自停止已运行设备。

本机验收入口：http://127.0.0.1:5174/mine-digital-twin 。服务停止时，使用项目原来的 `npm run dev` 启动，并访问其实际端口。

## 实现与模拟边界

| 系统 | 已联动 | 模拟边界 |
|---|---|---|
| 提升 | 一个绳位移同步驱动天轮、滚筒、导向轮角度、容器高度和容器端绳长；正确轴心旋转；静止轴承/支撑不转；运行/停止/故障冻结/恢复 | 1.6 米有限井口检修行程，自动往返而非深井作业；卷筒绳包保留静态外观，不做真实多层排绳、绳弹性和动力学 |
| 输煤 | 闭合带面弧长相位，承载/回程方向正确；端部滚筒、210 个托辊和实例煤流由带速驱动；三段转运与分流 | 煤块是代表性实例，不是逐颗粒散体物理；转载站内部转运为简化路由 |
| 煤仓 | 提升到顶的模拟卸料进入接收斗；接收斗出料经过输送延迟送往两仓；累计库存守恒；锥仓+圆柱有效容积映射料位与煤体 | 初始库存、每次卸料、堆积密度、流量和卸料速度均为演示参数，未接传感器或真实生产数据 |
| 电力 | 12 台配电柜独立三状态指示灯，变压器小型状态提示，明确馈线映射的停机联锁 | 人工状态与故障模拟，不是实际供电计算或 PLC 控制；天气预警不会自动造成电气故障 |

默认演示参数：提升峰值速度 0.35m/s、检查行程底部 0.12–1.72m；接收斗初始 40kg，每次模拟提升到顶卸入 65kg；输送默认 1m/s，接收斗按带速出料；堆积密度 800kg/m³。几何和接口保留在 Blender 参数/绑定文件，运行速度与方向通过控件调节。

## 验证结果

- Blender 后台实际执行成功，导出候选 GLB 并发布。
- 四个授权资产拆分前后几何边界最大偏差约 0.0000055m；原三角面数保持，配电柜灯具的 1008 面移入独立灯资源。
- 12 个配电柜 ID 与 SPD 预留保留，配电室屋顶、外壳及 SPD 原 GLB 不变。
- 实际 GLTFLoader 和实际 factoryRuntime 的几何级执行通过：轴心稳定、转角/位移公式、绳长关系、故障冻结、实例绘制及幂等释放。
- 30/60/144Hz 各运行 80 秒：绳位移、带面行程及质量结果一致。
- 对容器 17 个位置执行真实三角面 BVH 检查，无与原井架的碰撞；没有建立虚假的完整地下井筒。
- 浏览器实测启动、故障、恢复、调速；故障前后天轮四元数和容器高度不变，其他健康设备保持独立状态。
- 页面实测 SPD 选中 ID=`spd-lv-01` 且屋顶隐藏；图层隐藏/恢复、鼠标旋转与缩放、键盘平移、恢复鸟瞰均正常。
- 完整既有雷暴演示到达模拟预警时，提升、输煤和变压器仍处运行状态；退出后监测状态恢复正常。天气构图回归检查通过。
- `npm run type-check`、`npm run build-only` 通过。构建保留项目既有的大 chunk 警告，没有修改其他业务模块来消除警告。
- 19 个其他原 GLB、41 个其他功能文件的本轮前后 SHA256 相同，含井架、道路、山地、天气逻辑和 SPD。

## 性能记录

环境：Windows，本机 Codex 内嵌 Chromium；实际 WebGL renderer 为 **ANGLE Intel UHD / Direct3D11**，不是机器上另有的 NVIDIA 独显。1440×900，DPR≈1；工厂动画运行，剔除相机飞行/OrbitControls 移动时的测量帧。该记录为启动后的短窗口，不是各视角长期稳态保证。

| 指标 | 实测 |
|---|---:|
| CPU/帧间隔样本 | 32 帧 |
| 帧间隔中位数 / P95 | 25.0 / 46.2ms |
| 中位帧间隔折算 | 约 40FPS |
| CPU 渲染与标签中位耗时 | 2.2ms |
| CPU 工厂更新中位耗时 | 0.1ms |
| GPU 中位耗时 | 22.06ms，28 个异步 timer query 样本 |
| Draw Calls / 三角面 | 323 / 334,012（此帧视角与来料阶段） |
| 实际绘制几何 / 纹理对象数 | 308 / 161 |

210 个托辊合并为 9 个实例化绘制批次；三段煤流共 3 批，每段最多 512 个煤块实例。远景减少煤块代表数量，并跳过不可辨识的托辊姿态更新，库存与累计相位继续正确。近景机械阴影以 2Hz 刷新，保留原静态场景阴影策略以控制成本。

GLB 总量由 23 个 19,734,732 字节变为 26 个 19,726,364 字节，约 18.81MiB。资源对象数不是实测显存；本轮没有伪造显存用量或稳定 60FPS。更多来料与不同镜头会改变当帧三角面和 GPU 成本。

## 文件与资产

新增运行模块：`factorySimulation.ts`、`factoryRuntime.ts`、`factoryPerformance.ts`、`FactoryControls.vue`、`factoryRuntime.check.mjs`。

修改场景文件：`index.vue`、`sceneInteraction.ts`、`sceneCamera.ts`。容器相机按完整有限行程包围范围构图，其他实体的构图分支保留。

新增建模/验证：`scripts/blender/prepare_factory_animation.py`、`verify_factory_animation.mjs`、`verify_factory_motion.py`、`factory_animation.bindings.json`、`factory_animation.migration.json`、`FACTORY_ANIMATION.md` 与 `baselines/factory-v1/`。原三个生成脚本与原布局参数保留，语义准备脚本复用它们的实际几何生成函数。

修改资产：`mine-hoist-house.glb`、`mine-production-links.glb`、`mine-coal-conveyors.glb`、`mine-distribution-equipment.glb`。

新增资产：`mine-hoist-container.glb`、`mine-coal-material.glb`、`mine-power-indicators.glb`，另有动画绑定与专项 report。

原 protected/layout baseline 不静默重写，四个授权资产有明确旧版本归档与 SHA256 迁移记录。本轮专项验证替代不了依赖更早历史哈希的跨阶段验证；此前报告中的历史基线不匹配没有被伪装成通过。

## 可复查记录

- `tmp/factory-candidate-verification.json`：实际资产边界/结构检查。
- `tmp/factory-runtime-verification.json`：实际运行模块和状态/守恒检查。
- `tmp/factory-collision-verification.json`：实际三角面碰撞检查。
- `tmp/factory-browser-performance.json`：原始性能数据。
- `tmp/factory-browser-fault-check.json`：故障前后的实际姿态。
- `tmp/factory-weather-coexistence.json`：天气与设备状态独立。

截图：`factory-wheel-running.jpg`、`factory-container-running.jpg`、`factory-hoist-running.jpg`、`factory-conveyor-running.jpg`、`factory-silo-level.jpg`、`factory-spd-preserved.jpg`、`factory-park-running.jpg`，均在 `tmp/`，来自实际页面，不是离线效果图。煤仓截图已更新为锥仓与圆柱实体煤体版本。

![天轮运行近景](F:/code/lightning/tmp/factory-wheel-running.jpg)

![输煤系统运行](F:/code/lightning/tmp/factory-conveyor-running.jpg)

![园区全景](F:/code/lightning/tmp/factory-park-running.jpg)
