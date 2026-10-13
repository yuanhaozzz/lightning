# 电力保障区验收展示（2026-10-11）

本轮只添加临时定位交互与验收记录。现有 12 个 GLB 的哈希保持不变，没有执行模型生成或导出，没有修改园区布局、默认鸟瞰、其他区域和原建模脚本。

## 使用方式

- “定位电力保障区”：约 1.25 秒平滑飞到室外变电站近景。
- “配电室近景”：飞到配电室上方，可继续点击“隐藏配电室屋顶”查看两排配电柜。
- 原 OrbitControls 旋转、缩放、平移继续可用；手动操作或“恢复鸟瞰”会中断定位飞行。窗口尺寸变化时，仍处于定位视图的相机重新适配实际模型边界。
- 点击配电柜或安装预留实体，原有选择状态显示其名称和 ID。恢复屋顶后清除被遮挡的室内选择。

## 实际验证

`npm.cmd run build` 通过。`node scripts/blender/verify_power_area.mjs` 通过既有资源、间距及选中检查；该校验不涵盖下方新发现的吊杆连接问题。

浏览器实际完成两个定位、飞行中恢复鸟瞰、隐藏/恢复屋顶、滚轮缩放及实体点击。选中得到 `power-cabinet-mv-03`、`power-cabinet-lv-01` 和独立 `spd-distribution`。全部 12 个柜体及 4 个预留 ID 通过实际 GLB 射线检查。浏览器验收未记录警告或错误。

柜体无相互包围盒重叠，操作通道净宽约 2.70 米，背侧空间约 1.72 米。室外关键裸导体对接地构件表面最小采样距离约 0.547 米；基础与设备近景未观察到明显悬空或比例异常。此结论限于可视化检查及已记录的几何范围。

## 待修复问题

**现有桥架吊杆上端未与屋架或墙体结构相连。** 使用 Blender 后台只读导入现有 GLB，对 20 个吊杆端点与建筑三角面复核，最近表面间隙约 **0.190～0.362 米**。本轮按“不新增任何模型”的要求保留现状；电力区结构连接完整性尚未通过验收。原校验通过不能替代此项检查。

## 验收文件

- 室外近景：`tmp/mine-power-acceptance-outdoor.jpg`
- 室内近景（选中 SPD 预留 ID）：`tmp/mine-power-acceptance-interior.jpg`
- 资源与射线检查：`tmp/mine-power-acceptance-validation.json`
- 只读几何审计：`tmp/audit-power-acceptance.py`、`tmp/mine-power-acceptance-support-audit.json`
- 浏览器日志：`tmp/mine-power-acceptance-browser-log.json`

实现文件：`index.vue`、`powerInspection.ts`。到此停止，等待验收。
