# 动态工厂资产

`prepare_factory_animation.py` 在现有三个建模脚本的参数和几何生成函数上准备动画语义节点，不重建井架、不更改布局。运行命令：

```powershell
& 'D:\blender-5.2.2-windows-x64\blender-5.2.2-windows-x64\blender.exe' -b --factory-startup --python-exit-code 1 --python scripts/blender/prepare_factory_animation.py
node scripts/blender/verify_factory_animation.mjs
```

候选资源输出到 `tmp/factory-candidate`，检查通过后发布到 `public/models`。保留 `baselines/factory-v1` 中的原始四个资产，其他区域、井架、配电室外壳/屋顶与 SPD 保持原文件。

生成器导出 `animationId / factoryEntityId / animationRole / animationPivot / animationAxis / effectiveRadius`。字段中的坐标是米制 Y-up；原点与父级装配不变。滚筒、导向轮、托辊与固定支架分开。带面 UV.x 是闭合回路的米制弧长；承载、头部包覆、回程和尾部包覆共享同一相位。

运行时 `factoryRuntime` 复用 210 个托辊的几何，合并成 9 个实例化绘制批次；煤块每段一个实例批次。GLB 只需加载一次，不在运行/停止/故障切换时生成文件。

固定设备 ID 与动画节点 ID 分开。提升的绳位移决定轮转角和容器高度；1.6 米井口检修行程明确为示意。卷筒上的既有绳包保留静态外观，不模拟真实多层排绳。该功能不是实际煤矿提升控制或动力学求解。

逻辑采用 20Hz 固定步长累积秒制 delta；视觉在原渲染循环更新。提升容器到达顶部后将模拟煤量交给接收斗；接收斗出料、运输延迟、两仓入料和出料守恒。初始接收斗中 40kg、每次模拟提升卸料 65kg、密度 800kg/m³ 均为演示参数。

检修查看只做可恢复的提升机屋顶/输送机罩盖显隐和煤仓局部剖视，不实施第二阶段建筑爆炸图、柜门开启或下钻状态机。工厂控制与已有雷暴状态机独立。

验证入口：`node src/features/mine-digital-twin/factoryRuntime.check.mjs`。报告记录本轮授权资产迁移；原有历史 protected/layout 基线不静默改写。
