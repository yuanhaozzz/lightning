# 雷暴模拟演示：第五阶段第一小步

## 本轮范围

仅在 `/mine-digital-twin` 接入演示状态机、模拟数据和控制入口。没有新增或重新导出模型，没有更改 Blender 脚本、部署配置、灯光或默认相机，没有加入云团、闪电、巡航或防护联动。

底部「雷暴预警演示」展开小型控制卡。首次加载全部设备正常。开始后前 5 秒为正常阶段，随后 15 秒为模拟预警阶段；总计 20 秒后停止计时并保留预警状态。该停止点是本小步的终点，尚未实现六阶段完整演示。退出恢复设备正常，保留本页简单事件记录；重播从正常阶段开始。

## 文件及架构

- `stormDemoData.ts`：设备身份、独立运行状态、模拟时间及监测数据预留结构。统一标记「演示数据」；闪电事件和接地电阻字段保持 null，本轮不生成这些读数。
- `stormDemo.ts`：独立于 Vue/Three.js 的状态机。播放状态 idle / playing / paused / finished，演示阶段 normal / warning。start、pause、resume、replay、exit 为显式操作，update(deltaMs) 由现有动画循环驱动，无 setTimeout 或 setInterval。
- `StormDemoControls.vue`：控制卡、当前阶段、进度、两台监测仪状态、模拟预警时间及简短记录。收起控件不改变播放状态。
- `index.vue`：动画循环接入、模拟状态标签与选中信息、入口及资源清理。保持模型对象、业务 ID 和拾取流程。CSS2D 标签限制在场景的层叠上下文中，避免盖住控制卡。
- `stormDemo.check.mjs`：状态边界、冻结与恢复、状态独立性、重播、退出、记录容量、卸载及模型保护验证。

预警只将 `storm-warning-01` 切换为 warning；`lightning-location-01`、SPD、接地监测仪及其他设施保持 normal，各设备独立。状态颜色正常绿色、预警橙色；fault 类型为将来预留，本轮不会自动触发异常。建筑材质及选中高亮沿用现有逻辑。

模拟数据覆盖现有设备/设施 ID，配置和资源路径没有被修改。记录仅保存在本页内存，最多 20 条；刷新后不保留。时间以每次开始的时间为起点，加上演示累计时间，不是监测采集时间。

暂停冻结演示时间，继续从暂停点恢复；页面切到后台时自动暂停，返回后需手动继续，避免隐藏页面后时间跳跃。本小步没有自动镜头；手动旋转、缩放和定位仍使用原有 OrbitControls。卸载时移除 visibilitychange 监听、停止动画循环并释放状态机；无新增 Three.js 几何体、材质或纹理。

## 验证

```powershell
node src/features/mine-digital-twin/stormDemo.check.mjs
node tmp/verify-mine-interaction.mjs
npm run build
```

状态机检查通过，包括 4999/5000 ms 边界、暂停/后台暂停、不重复记录结束、跨阶段大步长、无效 delta、重播清零、退出恢复且保留记录、快照隔离、记录上限、卸载后不更新以及 ID 唯一性。

交互回归通过：34 个实体、11 类真实 GLB 网格拾取、33 组不同视口构图、图层与嵌套屋顶可见性、拖拽判定。原有 39 个模型与 Blender 文件 SHA256 全部保持一致。

浏览器实际启动演示并完成正常到预警切换，验证暂停、继续、重播和退出。确认只有雷暴预警仪进入预警、相机位置保持不变、屋顶隐藏及柜内 SPD 真实网格点击仍可用、图层隐藏仍清除选中。验收记录保存在 `tmp/mine-storm-demo-browser-check.json`，状态机检查结果在 `tmp/mine-storm-demo-validation.json`。

截图：`tmp/mine-storm-demo-normal.jpg`、`tmp/mine-storm-demo-warning.jpg`。本轮验收到此停止，后续步骤待确认。
