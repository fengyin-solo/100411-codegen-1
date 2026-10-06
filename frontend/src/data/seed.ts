import type { EntryRow } from './types'

// 示例数据：首次打开时播种，之后浏览器里的改动优先，重置才会回到这份。
// 机位、航班、区域字段按真实命名规则构造（T1-xxx / T2-xxx / T3-xxx），
// 缺机位归属的记录在数据迁移时按「机位直连 → 区域字段 → 航班反查 → 未归属」回填。
const DEMO_DATE = '2026-10-06'

// 每个模块默认 3 条：待处理正常态 / 处理中且被标异常 / 完结态；机位分配多 1 条 T1 待保障航班。
type SeedDef = {
  key: string
  fields: string[]
  codePrefix: string
  dateFields: string[]
  // 第三项可显式声明 pending；缺省时非末条的状态都算待处理。
  rows: [string, string[], boolean?][] // 状态 + 各字段值（首列编号留空时自动生成）
}

function buildRows(def: SeedDef): EntryRow[] {
  const lastIndex = def.rows.length - 1
  return def.rows.map(([status, values, pendingOverride], index) => {
    const row: EntryRow = {
      id: index + 1,
      status,
      pending: pendingOverride ?? index !== lastIndex,
      // 第二条固定为带异常标记的在办记录，其余按状态本身判定。
      abnormal: index === 1,
    }
    def.fields.forEach((field, fieldIndex) => {
      const value = values[fieldIndex] ?? `${def.key}样例${index + 1}`
      row[field] = def.dateFields.includes(field) && value === '' ? DEMO_DATE : value
    })
    // 首字段是编号列；航班保障模块首字段即航班号（值已给出），不再覆盖。
    if (!values[0]) {
      row[def.fields[0]] = `${def.codePrefix}-${String(index + 1).padStart(4, '0')}`
    }
    return row
  })
}

const DEFS: SeedDef[] = [
  {
    key: 'stand',
    fields: ['机位编号', '机位类型', '所属航站楼', '匹配航班', '计划占用', '实际占用', '分配状态', '备注说明'],
    codePrefix: 'STAN',
    dateFields: ['计划占用', '实际占用'],
    rows: [
      ['空闲', ['', '近机位', 'T1航站楼', '', '', '', '待分配', 'T1近机位']],
      ['已分配', ['', '远机位', 'T2航站楼', 'MU5102', DEMO_DATE, '', '已分配', '已排MU5102']],
      ['占用中', ['', '近机位', 'T3卫星厅', 'CA1831', DEMO_DATE, DEMO_DATE, '保障中', '卫星厅靠桥']],
      ['已分配', ['', '远机位', 'T1航站楼', 'MU5101', DEMO_DATE, '', '已分配', '待保障航班预排'], true],
    ],
  },
  {
    key: 'bridge',
    fields: ['廊桥编号', '所属机位', '对接机型', '调度人员', '计划对接', '实际对接', '脱离时间', '廊桥状态'],
    codePrefix: 'BRID',
    dateFields: ['计划对接', '实际对接', '脱离时间'],
    rows: [
      ['待对接', ['', 'T1-101', 'A320', '王建国', '', '', '']],
      ['已对接', ['', 'T2-208', 'B738', '李慧', DEMO_DATE, DEMO_DATE, '']],
      ['已脱离', ['', 'T3-503', 'A321', '周敏', DEMO_DATE, DEMO_DATE, DEMO_DATE]],
    ],
  },
  {
    key: 'ground_power',
    fields: ['设备编号', '设备类型', '所属机位', '输出电压', '额定电流', '供电开始', '供电结束', '设备状态'],
    codePrefix: 'GROU',
    dateFields: ['供电开始', '供电结束'],
    rows: [
      ['待机', ['', '静变电源', 'T1-102', '115V/400Hz', '90kVA', '', '']],
      ['供电中', ['', '柴油电源车', 'T2-209', '28.5V DC', '600A', DEMO_DATE, '']],
      ['故障停用', ['', '静变电源', 'T3-505', '115V/400Hz', '90kVA', DEMO_DATE, DEMO_DATE]],
    ],
  },
  {
    key: 'baggage',
    fields: ['转运编号', '关联航班', '行李件数', '出发转盘', '到达转盘', '装卸人员', '转运时长', '转运状态'],
    codePrefix: 'BAGG',
    dateFields: [],
    rows: [
      ['待卸机', ['', 'MU5101', '186件', 'T1-07', '', '行李一组', '—']],
      ['异常滞留', ['', 'MU5102', '243件', 'T2-12', '', '行李二组', '超时45分钟']],
      ['已到达', ['', 'CA1831', '152件', 'T3-03', 'T3-03', '行李三组', '22分钟']],
    ],
  },
  {
    key: 'cargo',
    fields: ['装卸编号', '关联航班', '货物品类', '件数吨位', '装卸班组', '计划开始', '实际完成', '装卸状态'],
    codePrefix: 'CARG',
    dateFields: ['计划开始', '实际完成'],
    rows: [
      ['待装卸', ['', 'MU5101', '普货/生鲜', '3.2吨', '货运一组', '', '']],
      ['装卸中', ['', 'MU5102', '快件', '5.8吨', '货运二组', DEMO_DATE, '']],
      ['异常中断', ['', 'CA1831', '普货', '2.1吨', '货运三组', DEMO_DATE, DEMO_DATE]],
    ],
  },
  {
    key: 'fueling',
    fields: ['加油编号', '关联航班', '燃油型号', '加油量', '加油车号', '加油开始', '加油结束', '记录状态'],
    codePrefix: 'FUEL',
    dateFields: ['加油开始', '加油结束'],
    rows: [
      ['待加油', ['', 'MU5101', 'Jet A-1', '—', '油车-12', '', '']],
      ['加油中', ['', 'MU5102', 'Jet A-1', '6800升', '油车-07', DEMO_DATE, '']],
      ['已复核', ['', 'CA1831', 'Jet A-1', '9200升', '油车-03', DEMO_DATE, DEMO_DATE]],
    ],
  },
  {
    key: 'catering',
    fields: ['配餐编号', '关联航班', '餐食类型', '配餐份数', '特殊需求', '配餐车辆', '送达时间', '配餐状态'],
    codePrefix: 'CATE',
    dateFields: ['送达时间'],
    rows: [
      ['待配餐', ['', 'MU5101', '热食正餐', '168份', '素食4份', '餐车-05', '']],
      ['装配中', ['', 'MU5102', '轻食', '192份', '无', '餐车-02', '']],
      ['已签收', ['', 'CA1831', '热食正餐', '156份', '清真2份', '餐车-09', DEMO_DATE]],
    ],
  },
  {
    key: 'cabin_clean',
    fields: ['清洁编号', '关联航班', '清洁类型', '清洁班组', '计划开始', '实际完成', '清洁用时', '清洁状态'],
    codePrefix: 'CABI',
    dateFields: ['计划开始', '实际完成'],
    rows: [
      ['待清洁', ['', 'MU5101', '过站清洁', '客舱一组', '', '', '—']],
      ['清洁中', ['', 'MU5102', '过站清洁', '客舱二组', DEMO_DATE, '', '—']],
      ['需复查', ['', 'CA1831', '航后深度清洁', '客舱三组', DEMO_DATE, DEMO_DATE, '48分钟']],
    ],
  },
  {
    key: 'lavatory',
    fields: ['排污编号', '关联航班', '服务车型', '操作人员', '开始时间', '结束时间', '排污量', '服务状态'],
    codePrefix: 'LAVA',
    dateFields: ['开始时间', '结束时间'],
    rows: [
      ['待服务', ['', 'MU5101', '排污车-03', '陈刚', '', '', '—']],
      ['服务中', ['', 'MU5102', '排污车-05', '刘洋', DEMO_DATE, '', '—']],
      ['设备异常', ['', 'CA1831', '排污车-02', '赵磊', DEMO_DATE, DEMO_DATE, '320升']],
    ],
  },
  {
    key: 'deicing',
    fields: ['除冰编号', '关联航班', '除冰液类型', '预计用量', '实际用量', '开始时间', '结束时间', '作业状态'],
    codePrefix: 'DEIC',
    dateFields: ['开始时间', '结束时间'],
    rows: [
      ['待除冰', ['', 'MU5101', 'I型除冰液', '400升', '—', '', '']],
      ['作业中', ['', 'MU5102', 'I/IV型混合', '800升', '—', DEMO_DATE, '']],
      ['已取消', ['', 'CA1831', 'I型除冰液', '600升', '0升', DEMO_DATE, DEMO_DATE]],
    ],
  },
  {
    key: 'pushback',
    fields: ['牵引编号', '关联航班', '牵引车型', '操作人员', '推出机位', '推出方向', '完成时间', '牵引状态'],
    codePrefix: 'PUSH',
    dateFields: ['完成时间'],
    rows: [
      ['待牵引', ['', 'MU5101', '有杆牵引车', '孙鹏', 'T1-103', '北向南', '']],
      ['已就位', ['', 'MU5102', '无杆牵引车', '马骏', 'T2-210', '南向北', '']],
      ['已完成', ['', 'CA1831', '有杆牵引车', '何伟', 'T3-506', '东向西', DEMO_DATE]],
    ],
  },
  {
    key: 'crew_schedule',
    fields: ['人员编号', '姓名', '岗位类别', '所属班组', '排班日期', '值班时段', '在岗状态', '联络方式'],
    codePrefix: 'CREW',
    dateFields: ['排班日期', '值班时段'],
    rows: [
      ['待排班', ['', '王建国', '廊桥操作员', 'T1航站楼甲班', '', '白班', '138****0101']],
      ['在岗', ['', '李慧', '调度员', 'T2航站楼乙班', DEMO_DATE, '白班', '138****0202']],
      ['已离岗', ['', '周敏', '机坪巡查', 'T3卫星厅班组', DEMO_DATE, '夜班', '138****0303']],
    ],
  },
  {
    key: 'special_vehicle',
    fields: ['车辆编号', '车辆类型', '品牌型号', '载重吨位', '购入日期', '维保周期', '上次维保', '车辆状态'],
    codePrefix: 'SPEC',
    dateFields: ['购入日期', '上次维保'],
    rows: [
      ['待命', ['', '摆渡车', '宇通ZK6122', '—', DEMO_DATE, '每月', '']],
      ['出车中', ['', '牵引车', 'Goldhofer AST-2', '60吨', DEMO_DATE, '每月', '']],
      ['已停用', ['', '传送带车', 'TUG660', '—', DEMO_DATE, '每季度', DEMO_DATE]],
    ],
  },
  {
    key: 'flight_ops',
    fields: ['航班号', '机尾号', '计划到港', '实际到港', '计划离港', '预计离港', '保障节点', '保障状态'],
    codePrefix: 'FLIG',
    dateFields: ['计划到港', '实际到港', '计划离港', '预计离港'],
    rows: [
      ['待保障', ['MU5101', 'B-1236', DEMO_DATE, '', DEMO_DATE, '', '待进港']],
      ['保障中', ['MU5102', 'B-5523', DEMO_DATE, DEMO_DATE, DEMO_DATE, '', '加油清洁中']],
      ['已延误', ['CA1831', 'B-6890', DEMO_DATE, DEMO_DATE, DEMO_DATE, DEMO_DATE, '等待除冰']],
    ],
  },
  {
    key: 'turnaround',
    fields: ['过站编号', '关联航班', '计划到港', '实际到港', '过站时长', '保障进度', '异常事项', '过站状态'],
    codePrefix: 'TURN',
    dateFields: ['计划到港', '实际到港'],
    rows: [
      ['待监测', ['', 'MU5101', DEMO_DATE, '', '—', '0%', '无']],
      ['监测中', ['', 'MU5102', DEMO_DATE, DEMO_DATE, '35分钟', '60%', '行李等待']],
      ['已超时', ['', 'CA1831', DEMO_DATE, DEMO_DATE, '70分钟', '90%', '除冰排队超时']],
    ],
  },
  {
    key: 'apron_safety',
    fields: ['巡查编号', '巡查区域', '巡查人员', '巡查日期', '发现问题', '整改措施', '复查结果', '安全状态'],
    codePrefix: 'APRO',
    dateFields: ['巡查日期'],
    rows: [
      ['待巡查', ['', 'T1航站楼机坪', '赵磊', '', '—', '—', '—', '待巡查']],
      ['待整改', ['', 'T2航站楼机坪', '孙鹏', DEMO_DATE, '208机位锥桶缺失', '已补设并通报', '待复查', '整改中']],
      ['已闭环', ['', 'T3卫星厅机坪', '周敏', DEMO_DATE, '503位FOD杂物', '现场清理完毕', '复查合格', '正常']],
    ],
  },
  {
    key: 'load_equip',
    fields: ['设备编号', '设备类型', '适用机型', '最大载重', '安装位置', '购入日期', '维保记录', '设备状态'],
    codePrefix: 'LOAD',
    dateFields: ['购入日期'],
    rows: [
      ['待机', ['', '集装板装载机', 'B738/A320', '7吨', 'T1货运站', DEMO_DATE, '正常']],
      ['运行中', ['', '传送带装载机', 'A321', '5吨', 'T2货运站', DEMO_DATE, '正常']],
      ['已报修', ['', '集装箱装载机', 'B777', '12吨', 'T3卫星厅货运站', DEMO_DATE, '液压异响待修']],
    ],
  },
  {
    key: 'air_emergency',
    fields: ['应急编号', '事件类型', '涉及航班', '事发位置', '响应等级', '响应人员', '处置措施', '应急状态'],
    codePrefix: 'AIRE',
    dateFields: [],
    rows: [
      ['待响应', ['', '旅客急病', 'MU5101', 'T1航站楼机位101', '三级', '值班主管+急救', '已呼叫急救', '待响应']],
      ['处置中', ['', '货物冒烟', 'MU5102', 'T2航站楼机位208', '二级', '消防+货运二组', '隔离排查中', '处置中']],
      ['已解除', ['', '地面剐蹭', 'CA1831', 'T3卫星厅机位503', '三级', '机坪三组', '定损登记完成', '已解除']],
    ],
  },
]

export const SEED_ROWS: Record<string, EntryRow[]> = Object.fromEntries(
  DEFS.map((def) => [def.key, buildRows(def)]),
)
