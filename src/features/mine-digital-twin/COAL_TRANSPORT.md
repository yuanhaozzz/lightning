# 第四阶段：煤炭运输区

本轮只替换两座煤仓、转载站及三段输送机。`layout.ts`、道路、围墙、相机、灯光及原四个生产区 GLB 保持原文件哈希；保护清单为 `scripts/blender/coal_transport.protected-baseline.json`。

## 结构与连接

- 煤仓：8.5 米直径混凝土仓体、钢制锥形仓底、四柱框架和斜撑、基础与锚栓、下部卸料闸门/接口、屋顶环形格栅及护栏、带护笼爬梯和中间休息平台、顶部滚筒支承及独立检修层。
- 转载站：四柱钢框架、分层梁和楼板、真实门窗及输送开孔、金属围护、内部三段检修楼梯、上层平台和接收滚筒雨棚。落料溜槽穿过实际楼板开孔，两条支线各有独立滚筒和重力落料口。
- 输送机：槽形橡胶带、三联承载托辊、回程带及托辊、头尾滚筒和包角带面、轴承/驱动及联轴器防护、侧桁架、偏置基础门架、两侧格栅走道与护栏、连接检修平台的小型钢梯。天气罩各留一个铰接开启的检修段，静态展示机械结构；无运行仿真。
- 现有平面路线保持不变。旧输送配置的 Y 值是体块参考包络，实际承载面用参数 `beltOffsets` 区分接收与支线标高，使转载站能够向较低的两条带面重力落料。支线实际坡度约 16.7°，重力溜槽大于 42°。煤仓屋顶与上部滚筒检修层分开，倾斜输送机不会切入仓壁。
- 首段两个门架使用 `supportBaseOffsets` 绕开检修步道和转载站维护支路，顶部仍承托原支架参数所在的桁架位置。跨车行道保守净空约 5.96 米，跨步道约 4.96 米。

三张用户参考图仅用于理解支承仓体、托辊/桁架和转载节点，没有读取为贴图。材料沿用现有井架的钢灰、混凝土、安全黄体系。组件关系另外核对了 [Rulmeca 承载/回程托辊及滚筒资料](https://www.rulmeca.com/en/bulk) 与 [BEUMER 槽形带式输送机资料](https://www.beumergroup.com/products-systems/conveyors-technology/troughed-belt-conveyors/)。

## 生成和接入

```powershell
& 'D:\blender-5.2.2-windows-x64\blender-5.2.2-windows-x64\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_coal_transport.py
node scripts/blender/verify_coal_transport.mjs
node src/features/mine-digital-twin/layout.check.mjs
node scripts/blender/verify_core_production.mjs
npm.cmd run build
```

脚本支持 `--parameters` 和 `--output-dir`；参数包括锚点、参考尺寸、输送路线、工作标高偏移、门架基础偏置、托辊间距/截面边数和检修罩状态。修改相连接口参数时应同时复核站内落差、建筑开孔和净空。

`transportModels.ts` 仅保存 ID 到资源及原点策略的映射。`parkScene.ts` 沿用 GLTFLoader 和模型替换流程；建筑按原底面中心定位，固定比例 1，输送机采用世界坐标 GLB。加载成功后删除旧输送线与支架，并释放占位几何和私有材质。不改写原布局的坐标、尺寸、旋转或路由。

## 资源检查

| 资源 | 三角面 | 材质/合并网格 | 字节 |
| --- | ---: | ---: | ---: |
| `mine-coal-silo-1.glb` | 26,680 | 6 | 1,708,452 |
| `mine-coal-silo-2.glb` | 26,708 | 6 | 1,709,796 |
| `mine-transfer-station.glb` | 13,360 | 8 | 1,150,136 |
| `mine-coal-conveyors.glb` | 34,244 | 7 | 2,187,664 |
| 合计 | 100,992 | 27 | 6,756,048 |

GLB 自包含纹理；检查二进制结构、有限坐标/UV、单位法线、PBR 范围、材质数量及面数。小型截面采用 6～12 边，按材质合并网格，继续使用既有静态阴影与按需绘制。

生成时对仓壁、楼板、围护、楼梯及护栏的实际三角几何做 56,160 次射线检查，测试承载/回程带中线与边缘、左右桁架上/下弦；没有发现穿越。轴承、托辊和受料接口的预期接触不计作碰撞。这是针对关键通行面的检查，不是所有零件之间的穷举碰撞证明。独立检查另涵盖基础与道路重叠、输送坡度、重力落差、煤仓进料接口和保护文件哈希。

`public/models/mine-coal-transport.report.json` 保存生成及连接数据，`mine-coal-transport.verification.json` 保存检查结果；Blender 日志为 `tmp/coal-transport-blender.log`。验收截图和浏览器日志位于 `tmp/mine-transport-*.jpg`、`tmp/mine-transport-browser-log.json`。

浏览器已实际加载 8 个 GLB（含原生产区 4 个），旋转、缩放、方向键平移、标识开关及恢复鸟瞰通过。最终带标识的 32 次暖机互动绘制采样：CPU 绘制与标识处理中位约 7.2 ms、P95 13.2 ms，102 次绘制调用，236,930 个场景三角面；首次采样中位 16 ms、P95 32.4 ms。数据不等于 GPU 帧率或全设备性能保证。静止时继续按需绘制，阴影复用；未出现浏览器加载错误或 Blender 导出警告。`tmp/mine-transport-performance.json` 保存最终采样。构建与类型检查通过，原有其他业务块的体积提示仍存在，未调整这些模块。

本阶段完成后停止；未增加其他区域建筑细节、雷电设备、业务 UI 或天气效果。
