// 内存 localStorage 垫片：纯前端数据层直接在 Node 里跑。
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, String(value)),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: (index: number) => [...mem.keys()][index] ?? null,
  get length() {
    return mem.size
  },
} as Storage
globalThis.window = globalThis as unknown as Window & typeof globalThis

import { allRows, listRows } from '../src/data/local-store'
import { resolveArea } from '../src/data/areas'
import { loadOverview } from '../src/api/local-service'
import {
  currentRuleVersion,
  draftToken,
  listBoardCells,
  moveCell,
  sealHandover,
  switchRuleVersion,
  toggleCellLock,
} from '../src/api/handover'

let failures = 0
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}`)
  }
}

console.log('1) 存量归属回填与态势归集')
const overview = loadOverview()
assert(overview.areas.length === 2, '态势视图按 T1/T2 两个区域列出')
const t1 = overview.areas.find((a) => a.area === 'T1')!
const t2 = overview.areas.find((a) => a.area === 'T2')!
assert(t1.modules.length === 18 && t2.modules.length === 18, '每个区域都列出全部 18 个业务模块')
assert(t1.created >= 30 && t2.created >= 15, `区域有登记量 T1=${t1.created} T2=${t2.created}`)

const rows = allRows()
assert(resolveArea('bridge', rows.bridge[0]).area === 'T1', 'P1 机位直查：廊桥 T1-101 → T1')
assert(resolveArea('bridge', rows.bridge[0]).via === 'P1', 'P1 命中标记正确')
assert(resolveArea('bridge', rows.bridge[1]).area === 'T1', 'P1：故障廊桥挂 T1-102 → T1')
assert(resolveArea('ground_power', rows.ground_power[1]).area === 'T1', 'P4 兜底：机位「待定」的电源车 → 模块外兜底 T1')
assert(resolveArea('ground_power', rows.ground_power[1]).via === 'P4', '兜底回填标记为 P4')
assert(resolveArea('baggage', rows.baggage[2]).area === 'T2', 'P2 航班反查：HU7801 → T2-201 → T2')
assert(resolveArea('apron_safety', rows.apron_safety[2]).area === 'T2', 'P3 区域线索：巡查区域「T2机坪东侧」→ T2')
assert(resolveArea('crew_schedule', rows.crew_schedule[2]).area === 'T1', 'P4：无区域文本的排班记录 → T1 兜底')

console.log('2) 交接格排列')
const before = listBoardCells().map((c) => c.id)
moveCell(before[1], -1)
const after = listBoardCells().map((c) => c.id)
assert(after[0] === before[1] && after[1] === before[0], '值班主管上移格子：第 2 格排到第 1 格')

console.log('3) 规则换版：未锁格重算、已锁格快照不改写')
assert(currentRuleVersion() === 2, `初始规则版本 v2（当前=${currentRuleVersion()}）`)
const baggageT1 = () => listBoardCells().find((c) => c.id === 'T1:baggage')!
const baggageMetricsBefore = { ...baggageT1().metrics }
assert(baggageMetricsBefore.abnormal >= 1, 'v2 口径：异常滞留的行李计入异常量')
toggleCellLock('T1:baggage')
switchRuleVersion(1)
const lockedCell = baggageT1()
assert(lockedCell.locked && lockedCell.stale, 'v2→v1 后已锁格子标记为历史快照(stale)')
assert(
  lockedCell.metrics.abnormal === baggageMetricsBefore.abnormal,
  `已锁快照不改写：异常量保持 ${lockedCell.metrics.abnormal}`,
)
const lavT1 = listBoardCells().find((c) => c.id === 'T1:deicing')!
assert(lavT1.metrics.abnormal === 0, '未锁格子按 v1 重算：已取消的除冰记录在 v1 不计异常')
switchRuleVersion(2)
assert(baggageT1().metrics.abnormal === baggageMetricsBefore.abnormal, 'v1→v2 已锁快照依旧不改写')
toggleCellLock('T1:baggage')
assert(baggageT1().metrics.abnormal >= 1 && !baggageT1().locked, '解锁后按 v2 重新统计并恢复实时')

console.log('4) 交班封存：机坪台账联动 + 单一结论')
const apronBefore = listRows('apron_safety').length
const token = draftToken()
const seal = sealHandover({ token, operator: '测试主管', shiftLabel: '白班 08:00-20:00', conclusion: '测试交班结论' })
assert(seal.ok, '首个封存成功')
const todos = listRows('apron_safety').length - apronBefore
assert(todos > 0 && todos === seal.doc!.todosCreated, `机坪安全台账生成 ${todos} 条交班待办`)
const todoRows = listRows('apron_safety').filter((r) => r['来源交班'] === seal.doc!.id)
assert(todoRows.length === todos, '待办记录可追溯到封存版本号')
assert(todoRows.every((r) => r.status === '待巡查' && r.pending === true), '待办初始为「待巡查」且待处理')
assert(loadOverview().conclusion?.id === seal.doc!.id, '概览呈现的结论就是封存版本（同一份）')

console.log('5) 并发封存：只保留首个版本')
const second = sealHandover({ token, operator: '另一主管', shiftLabel: '夜班', conclusion: '后到的封存' })
assert(!second.ok, '旧令牌重复确认被 CAS 拒绝')
const rival = sealHandover({ token: draftToken(), operator: '另一主管', shiftLabel: '夜班', conclusion: '新一轮封存' })
assert(rival.ok, '新一轮草稿有新令牌，可以正常封存')
const overviewAgain = loadOverview()
assert(
  overviewAgain.conclusion?.id === rival.doc!.id && overviewAgain.conclusion!.conclusion === '新一轮封存',
  '封存列表首版被保留，概览读到的是最新首个成功版本',
)

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
if (failures > 0) {
  process.exit(1)
}
