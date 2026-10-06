# 机场地面保障调度管理系统

面向航班机位分配、廊桥调度、行李转运、货物装卸、航空加油、航食配餐与客舱清洁全流程的机场地面保障调度管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 机位分配 | `stand` | 机位分配 | 机位编号、机位类型、所属航站楼 |
| 廊桥调度 | `bridge` | 廊桥 | 廊桥编号、所属机位、对接机型 |
| 地面电源 | `ground_power` | 地面电源 | 设备编号、设备类型、所属机位 |
| 行李转运 | `baggage` | 行李转运 | 转运编号、关联航班、行李件数 |
| 货物装卸 | `cargo` | 货物装卸 | 装卸编号、关联航班、货物品类 |
| 航空加油 | `fueling` | 加油记录 | 加油编号、关联航班、燃油型号 |
| 航食配餐 | `catering` | 配餐任务 | 配餐编号、关联航班、餐食类型 |
| 客舱清洁 | `cabin_clean` | 清洁任务 | 清洁编号、关联航班、清洁类型 |
| 排污服务 | `lavatory` | 排污记录 | 排污编号、关联航班、服务车型 |
| 除冰作业 | `deicing` | 除冰记录 | 除冰编号、关联航班、除冰液类型 |
| 牵引车调度 | `pushback` | 牵引任务 | 牵引编号、关联航班、牵引车型 |
| 地勤排班 | `crew_schedule` | 地勤人员 | 人员编号、姓名、岗位类别 |
| 特种车辆 | `special_vehicle` | 特种车辆 | 车辆编号、车辆类型、品牌型号 |
| 航班保障 | `flight_ops` | 航班保障 | 航班号、机尾号、计划到港 |
| 过站监控 | `turnaround` | 过站记录 | 过站编号、关联航班、计划到港 |
| 机坪安全 | `apron_safety` | 机坪安全 | 巡查编号、巡查区域、巡查人员 |
| 装卸设备 | `load_equip` | 装卸设备 | 设备编号、设备类型、适用机型 |
| 应急保障 | `air_emergency` | 应急保障 | 应急编号、事件类型、涉及航班 |

## 运营概览：航站楼态势与值班交接

运营概览（`/`）在原模块汇总之外，新增按航站楼区域划分的「态势交接格」：

- 每个区域格列出 **业务模块数、登记总量、待处理、异常量**，并可展开该区域各模块的分项
  与异常明细（点击可跳到对应业务页）。
- 值班主管可用格内 ↑/↓ **排列交接格**，顺序按班次（日期+白/夜班）分别记住。
- **交班确认并封存**：整盘结论（格子数值、排列顺序、异常引用、规则版本、封存人/时间）冻结为
  快照；封存同时在机坪安全台账按区域生成「交班待办」巡查记录（`APRO-HAND-xxxx`）。
- 概览呈现与「导出保障清单」**共用同一份结论**：未封存读实时计算，已封存读同一快照。
- 历史班次快照可在概览右上角下拉回看；已锁快照不会被后续业务数据或规则换版改写。

配套约定（实现集中在 `src/data/regions.ts` 与 `src/api/local-service.ts`）：

- **统计规则版本**：当前 `v2`（异常量 = 被标异常 + 处于异常态的记录）。规则换版只递增
  `RULES_VERSION`；实时格带新版本号重算，封存格冻结在封存时的版本。
- **并发封存**：用 Web Locks（`airport-ground-handling:seal`）串行化跨标签页封存，
  落库前后再做一次 CAS 判重，冲突时只保留首个封存版本，后到的封存判负。
- **存量迁移**：数据结构版本存于 `airport-ground-handling:meta`；v1→v2 为所有缺
  「归属区域」的记录回填，优先级为
  ①机位编号/所属机位等经「机位→航站楼」映射直连
  ②记录自带的所属航站楼/巡查区域字段
  ③关联航班反查机位分配里该航班停靠的航站楼
  ④其余字段文本中的 T1/T2/T3/卫星厅 字样
  ⑤兜底进「未归属」，由人工补录。
- 交班快照存 `airport-ground-handling:handover:<日期>#<班次>`，格子顺序存
  `airport-ground-handling:cell-order:<日期>#<班次>`。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `airport-ground-handling:entries` 这一项，或调用 `resetModule(模块)`。
