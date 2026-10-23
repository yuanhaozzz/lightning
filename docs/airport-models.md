# AEROTWIN 模型与坐标说明（V0.2）

当前资产版本：`0.2.0`。建模和实际 GLB 导出工具：Blender `5.2.2 LTS`。模型由独立脚本生成，可再次编辑或替换，未复用旧页面业务模型。V0.1 的初版源文件和截图保留为历史记录；本文描述当前资源，末尾说明版本差异。

## 单位、朝向和标定

所有长度使用米。Blender 场景采用 `METRIC`，`scale_length = 1`。生成脚本的参数统一使用浏览器坐标：`+X` 指向飞机左侧 / port，`+Y` 向上，`+Z` 指向机头，地面为 `Y = 0`。

`common.coord()` 将浏览器坐标 `(x, y, z)` 写为 Blender 坐标 `(x, -z, y)`。GLB 导出使用 `export_yup=True`，在 Three.js 中按模型原始单位、原始朝向加载，不再逐件旋转或以不同缩放补偿。

正式模型之前运行 `calibrate.py`，导出 `calibration.glb`：立方体尺寸为 `1 × 1 × 1 m`，中心在浏览器 `(0, 0.5, 0)`，底部位于地面；红、绿、蓝标识分别为正 X、正 Y、正 Z。标定信息保存在 `public/models/airport/calibration.json`；浏览器标定结果由验收记录保存。正式资源与标定资源分开加载。

## 可替换资源与根节点

五个正式 GLB 的资产根节点均保持场景原点，资源共用米制布置空间。`vehicles.glb` 内部可动牵引车和第一节拖车有真正的局部坐标：各 actor root 位于后轴的地面投影处，导出时已带初始停车世界位置。运行时按配置覆盖 actor root 的绝对位置和朝向，不能把停车位再叠加一次，也无需修补缩放。替换资源应遵守 `assets/blender/vehicle-interface.json` 的节点和坐标约定。

| 文件 | 根节点 | 重要子节点 / 结构 |
| --- | --- | --- |
| `public/models/airport/aircraft.glb` | `Aircraft_A320neo_root` | 舱窗、舱门、独立机翼、尾翼、两台 LEAP-1A 外观发动机、风扇与起落架；`Aircraft_L1_anchor`、`Aircraft_forward_cargo_anchor` |
| `public/models/airport/terminal.glb` | `Terminal_A21_ROOT` | `Terminal_structure`、`Terminal_curtain_wall`、`Terminal_simplified_interior`、`Terminal_distant_original_hangars` |
| `public/models/airport/bridge.glb` | `PassengerBridge_A21_ROOT` | `Bridge_fixed_rotunda_PIVOT`；`Bridge_fixed_elevated_corridor`、`Bridge_fixed_corner_corridor`；`Bridge_outer_tunnel`；`Bridge_inner_telescopic_tunnel`；`Bridge_rotating_docking_cab_PIVOT`；`Bridge_mobile_support_PIVOT` 和独立轮组 |
| `public/models/airport/apron.glb` | `Apron_A21_ROOT` | 按材质合并的混凝土板块、两张内嵌程序纹理、`Apron_demonstration_markings` |
| `public/models/airport/vehicles.glb` | `GroundEquipment_A21_ROOT` | `PushbackTractor_ROOT`；`BaggageTractor_ROOT`；`BaggageCart_1_ROOT`、`BaggageCart_2_ROOT`；Steer、Roll、FrontBogie、独立 Drawbar 与连接锚点；锥桶和六组飞机轮挡 |

运行 `generate.py` 后，`manifest.json` 记录各资源实际根节点、对象数和文件字节数。它是模型文件大小的依据，不等同于某个浏览器帧的三角面数或 draw calls；后两项必须从运行现场采样。

## 飞机的尺度与结构

本机采用 A320neo 外观与一致的 LEAP-1A 外观方向。飞机由平滑变化的机身截面、独立翼型网格、发动机壳体、风扇叶片、尾翼、起落架、曲面窗口与舱门组成。喷漆以白色和克制的灰蓝色为主，无真实航司标识。

| 校核项目 | 建模基准 | 说明 |
| --- | --- | --- |
| 机长 | 37.57 m | 机头 `Z = +18.785`，尾端 `Z = -18.785` |
| 翼展 | 35.80 m | 左右翼尖最外侧 `X = ±17.90` |
| 机高 | 11.76 m | 从地面至最高尾翼轮廓 |
| 机身宽度 | 3.95 m | 主机身最大横截面直径；舱门描边等表面细节单独保留 |

这些数值来自 [Airbus A320neo 官方外形尺寸](https://www.aircraft.airbus.com/en/aircraft/a320-family/a320neo)。它们是模型的建模目标；实际导出包围盒测量和浏览器核对在验收记录中另行记录。不能由这四项总尺寸推断本模型所有局部曲率和机械构件均符合工程尺寸。

L1 前左客舱门沿飞机 `Z = 13.50`，门槛高 `Y = 3.40`，门顶约 `Y = 5.25`，门宽沿 Z 约 `0.84 m`。对接设计基准为 `(2.02, 3.40, 13.50)`。飞机、舱门、风扇与廊桥在当前展示中保持静态。

V0.2 新增两个直接挂在飞机根节点下的 **reference anchor**，不作为舱门铰链：`Aircraft_L1_anchor = (1.980802, 4.325, 13.5)`；`Aircraft_forward_cargo_anchor = (-1.675218, 3.06, 8.6)`。它们是场景交互定位依据，不能据此声称已校核真实装卸作业接口。

前轮中心高度 `0.39 m`，轮胎半径 `0.39 m`；主轮中心高度 `0.58 m`，轮胎半径 `0.58 m`。车辆和廊桥支撑轮也以轮心高度等于轮胎半径布置。飞机六个轮胎各有前后成对轮挡，共十二块，保留六个独立组；实际模型胎面与轮挡峰顶的检查结果见资产验证报告。

## 航站楼、廊桥与地面布置

V0.2 航站楼位于飞机 port / +X 侧，主幕墙约 `X = 24 m`，主体范围约 `X = 24…37 m`、`Z = -30…32 m`。屋檐、标牌等结构的实际范围略大：`X = 22.89…37.8 m`、`Y = 0…12.515 m`、`Z = -31…33 m`。主航站楼单独在 Blender 内旋转布置，不旋转远景。玻璃使用 Alpha 不透明度 0.68 的基础反射材质，背后保留真实墙体与楼层，当前未建完整室内。两栋原创低细节远景机库中心仍为 `(-55, 3, -115)` 与 `(5, 4, -140)`；低基础跨越 `Y = -0.28 m` 的背景地平面，避免建筑悬空。

固定高架连廊从航站楼出口 `(24, 4.65, 20)` 延伸到 `(18, 4.65, 20)`，再接至 `(14, 4.65, 13.5)` 的回转固定端。两段伸缩通道保持同一轴线，沿 X 方向从 `14 m` 经 `8 m` 延伸到约 `3.3 m`，位于客舱门的 `Z = 13.5 m` 横向平面。移动支撑轮组位于约 `(7, 0, 13.5)`，固定结构柱位于连廊下方。地板以 `3.40 m` 门槛高布置；柔性折棚的前端随机身横截面收分。玻璃通道保留真实地板、屋面与桁架。支撑结构、轮组、液压杆、服务梯、下部管路和橡胶折棚分开制作；当前没有运动求解或真实机械约束验证。

机坪为约 `200 × 200 m` 的混凝土地面，以几何板块间隙表现接缝。V0.2 使用两张原创 `1024 × 1024` 程序纹理：细颗粒 / 柔和磨损颜色图，以及局部粗糙度图；均打包进 `.blend` 并内嵌于机坪 GLB。颜色图乘以各板块独立色因子，粗糙度也有轻微差异；取消先前硬边磨损片和长黑条。A21 引导线、停止线和待命区属于演示标线，**未经真实机场规范校核**。

飞机牵引车静态中心为 `(21, 0, 5)`；可动行李牵引车后轴地面 root 初始为 `(-28, 0, 14)`；第一节拖车后轴地面 root 初始为 `(-28, 0, 9.76)`；第二节拖车静态车体中心为 `(-34, 0, 18)`。初始朝向均为 +Z。活动车组待命标线中心为 `(-28, 12.8)`，已移除旧待命点位于活动路线区域内的锥桶、轮挡。

## V0.2 车辆局部接口

权威接口文件为 `assets/blender/vehicle-interface.json`，每次 Blender 生成时更新，包含所有语义节点的实际父级、局部变换、停车世界姿态、尺寸和构建检查值。

- 牵引车：轮胎半径 `0.37 m`、宽 `0.22 m`、轴距 `1.83 m`、轮距 `1.34 m`。前轮为 `BaggageTractor_Front_PosX_Steer → BaggageTractor_Front_PosX_Roll` 和 NegX 对应组；后轮为 `BaggageTractor_Rear_PosX_Roll` / NegX。Steer 绕本地 Y，Roll 绕本地 X；所有运动空节点保持单位旋转。后连接点 `BaggageTractor_RearHitch_anchor` 的 root 局部位置为 `(0, 0.4, -0.62)`。
- 第一节拖车：轮胎半径 `0.31 m`、宽 `0.18 m`、轴距 `2.10 m`、轮距 `1.82 m`。`BaggageCart_1_FrontBogie` 位于 root 局部 `(0, 0, 2.10)`，绕 Y 回转；两个前轮 Roll 和独立 `BaggageCart_1_Drawbar` 跟随其运动，两个后轮 Roll 留在车体下。前连接点 `BaggageCart_1_FrontHitch_anchor` 相对 FrontBogie 为 `(0, 0.4, 1.52)`，与初始牵引车后连接点重合。
- PosX / NegX 明确指本地 X 的正负侧，避免把飞机 port / starboard 与道路车辆左右约定混用。第二节拖车保留为独立静态 actor。
- 重设 root 与轮轴前后使用不可变世界矩阵快照断言，防止重新挂父节点时破坏网格外观；随后仅整体移动至停车位。接口修复不代表完整车辆动力学、碰撞体、真实转向机构或航空保障操作认证。

## 源文件与再生成

当前正式 Blender 源文件：`assets/blender/aerotwin-v0.2.blend`。V0.1 历史源文件：`assets/blender/aerotwin-v0.1.blend`。标定源文件：`assets/blender/calibration.blend`。脚本目录包含 `common.py`、`aircraft.py`、`environment.py`、`calibrate.py`、`generate.py` 和生成的 `vehicle-interface.json`。公共模型目录保存当前 V0.2 导出版本，V0.1 历史场景可从旧 `.blend` 打开。

在项目根目录执行（`blender` 替换为本机实际可执行文件路径）：

```powershell
blender --background --python assets/blender/calibrate.py
blender --background --python assets/blender/generate.py
node scripts/airport-vehicle-assets-check.mjs
```

应先核对标定物体再导出正式资产。`begin_asset(name)` 仅替换名为 `AEROTWIN_<name>_v01` 的本项目生成集合，不执行场景全局删除。导出只选择当前生成集合。不要把用户手工创建的无关对象放入这些保留集合；重复生成时该集合内容会按脚本重建。生成脚本也会覆盖本项目约定的 GLB、manifest 和正式 `.blend` 输出文件。

静态重复构件按父节点及材质合并，减少 draw calls。环境模型合并前应用倒角，并把原始零件名称写入 `sourcePartNames` 元数据。轮组、舱门、风扇和廊桥机构的层级仍独立保留。当前版本没有把所有资产合成单个不可拆网格。

## 实际导出接口检查

`scripts/airport-vehicle-assets-check.mjs` 要求存在已完成的 V0.2 导出记录，通过 Node 中的 Three.js `GLTFLoader` 实际解析 `vehicles.glb` 与 `aircraft.glb`，把结果写入 `docs/airport-v02-vehicle-assets.json`。报告记录模型 SHA-256、字节数、源接口哈希和各项实际测量。

当前报告为 **65 项检查通过，0 失败**：语义节点局部变换、8 个可动车轮的真实胎面和轮轴、6 组共 12 个飞机轮挡、连接点世界重合、两个飞机 reference anchor，以及只在内存施加的 Steer / Roll / FrontBogie 试姿态。试姿态检查车轮不绕错误原点公转、车体和第二节拖车保持稳定，并恢复初始连接。它是实际 GLB 的几何和接口证据，**不是浏览器截图、完整运行任务验收或 GPU 性能测试**。

## V0.1 历史说明

V0.1 交付了米制 Blender → GLB → 浏览器标定、单一机位静态场景、基础 UI 和实际浏览器截图，历史目录为 `docs/screenshots/v0.1/`。当时车辆全部静态，轮组名称和元数据没有保证空节点处在真实轮心。V0.2 在保留原始资产外观的基础上修复活动车组轴心与连接接口，重排 port 侧航站楼和固定廊桥，调整待命区，并增加粗糙度纹理。当前节点与坐标以 V0.2 接口文件为准，不能把历史截图当作当前布局证据。

## 尚未精细化的内容

- 机身曲率、驾驶舱窗局部造型、翼型、翼面接缝和控制面均为原创近似重建；没有使用 Airbus 工程曲面或制造图。尺寸基准并不代表工程级复刻。
- 发动机采用统一 LEAP-1A 外观方向，保留进气口、风扇和排气层次；内部机械、叶片截面和附件尚未按生产结构逐件复原。
- 起落架管线、舱门铰接与锁止机构、控制面驱动、廊桥伸缩与调平机构尚未完成工程约束或动画。
- 幕墙使用基础反射材质，航站楼只有必要的简化内层结构；尚未提供完整室内、精细玻璃污迹和建筑施工细节。
- 机坪磨损与轮迹由原创 1K 颜色和粗糙度纹理轻量表现；没有摄影纹理、复杂污损贴花或夜景系统。
- 车辆属于可辨识的原创工业设备外观，未声称复刻特定厂家型号；舱内座椅、操作面板和底盘机械细节尚未精细化。
- 本轮以可继续打磨的米制三维资产为交付目标，未声称达到照片级最终效果。浏览器截图、实际运行性能与最终视觉验收请查阅独立验收记录。
