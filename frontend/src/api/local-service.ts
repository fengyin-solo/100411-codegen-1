import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  readStore,
  resetRows,
  saveRows,
  writeStore,
} from '@/data/local-store'
import {
  RULES_VERSION,
  UNKNOWN_REGION,
  computeRegionCells,
  isAbnormalRow,
  regionRank,
  sortByRegionOrder,
} from '@/data/regions'
import type {
  AbnormalRef,
  ActionResult,
  EntryRow,
  HandoverHistoryItem,
  HandoverSnapshot,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RegionCell,
  SessionContext,
  TerminalSituation,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => isAbnormalRow(row)).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 航站楼态势视图 + 值班交接
// ---------------------------------------------------------------------------

const HANDOVER_KEY_PREFIX = 'handover:'
const ORDER_KEY_PREFIX = 'cell-order:'
const APRON_SAFETY_KEY = 'apron_safety'

function shiftKeyOf(label: string, dateKey: string): string {
  return `${dateKey}#${label}`
}

function handoverStorageKey(shiftKey: string): string {
  return `${HANDOVER_KEY_PREFIX}${shiftKey}`
}

export function listHandoverHistory(): HandoverHistoryItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const items: HandoverSnapshot[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index)
    if (storageKey?.startsWith('airport-ground-handling:handover:')) {
      const snapshot = readStore<HandoverSnapshot>(
        storageKey.replace('airport-ground-handling:', ''),
      )
      if (snapshot) {
        items.push(snapshot)
      }
    }
  }
  return items
    .sort((a, b) => (a.sealedAt < b.sealedAt ? 1 : -1))
    .map((snapshot) => ({
      shiftKey: snapshot.shiftKey,
      shiftLabel: snapshot.shiftLabel,
      sealedAt: snapshot.sealedAt,
      sealedBy: snapshot.sealedBy,
    }))
}

function loadSnapshot(shiftKey: string): HandoverSnapshot | null {
  return readStore<HandoverSnapshot>(handoverStorageKey(shiftKey))
}

function loadOrder(shiftKey: string): string[] | null {
  return readStore<string[]>(`${ORDER_KEY_PREFIX}${shiftKey}`)
}

function orderByPreference(cells: RegionCell[], preference: string[] | null): RegionCell[] {
  if (!preference || preference.length === 0) {
    return cells
  }
  const rank = new Map(preference.map((region, index) => [region, index]))
  return [...cells].sort((a, b) => {
    const ra = rank.has(a.region) ? rank.get(a.region)! : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.region) ? rank.get(b.region)! : Number.MAX_SAFE_INTEGER
    if (ra !== rb) {
      return ra - rb
    }
    // 偏好里没有的新区域按区域自然顺序补在后面。
    return regionRank(a.region) - regionRank(b.region)
  })
}

function situationFromSnapshot(
  snapshot: HandoverSnapshot,
  history: HandoverHistoryItem[],
  currentShiftKey: string,
): TerminalSituation {
  return {
    shiftKey: snapshot.shiftKey,
    shiftLabel: snapshot.shiftLabel,
    sealed: true,
    viewingHistory: snapshot.shiftKey !== currentShiftKey,
    sealedAt: snapshot.sealedAt,
    sealedBy: snapshot.sealedBy,
    rulesVersion: snapshot.rulesVersion,
    order: snapshot.order,
    cells: orderByPreference(snapshot.cells, snapshot.order),
    history,
  }
}

// 读航站楼态势：已封存班次给冻结快照（概览与保障清单共用这一份结论），
// 未封存班次按当前规则版本实时计算格子。
export function loadTerminalSituation(
  session: SessionContext,
  dateKey: string,
  viewShiftKey?: string,
): TerminalSituation {
  const currentShiftKey = shiftKeyOf(session.shiftLabel, dateKey)
  const history = listHandoverHistory()
  const targetShiftKey = viewShiftKey ?? currentShiftKey

  const historySnapshot = loadSnapshot(targetShiftKey)
  if (historySnapshot) {
    return situationFromSnapshot(historySnapshot, history, currentShiftKey)
  }

  // 没封存：实时格 + 主管排过的顺序。
  const liveCells = computeRegionCells(allRows())
  const order = loadOrder(currentShiftKey) ?? sortByRegionOrder(liveCells.map((cell) => cell.region))
  return {
    shiftKey: currentShiftKey,
    shiftLabel: session.shiftLabel,
    sealed: false,
    viewingHistory: false,
    sealedAt: null,
    sealedBy: null,
    rulesVersion: RULES_VERSION,
    order,
    cells: orderByPreference(liveCells, order),
    history,
  }
}

// 值班主管排列交接格：只在当前班次未封存时允许，顺序按班次分别记住。
export function moveTerminalCell(
  session: SessionContext,
  dateKey: string,
  region: string,
  direction: -1 | 1,
): ActionResult {
  const shiftKey = shiftKeyOf(session.shiftLabel, dateKey)
  if (loadSnapshot(shiftKey)) {
    return { ok: false, message: '本班次已完成交班封存，格子顺序已随快照锁定，不能再调整' }
  }
  const cells = computeRegionCells(allRows())
  const preference = loadOrder(shiftKey) ?? sortByRegionOrder(cells.map((cell) => cell.region))
  const ordered = orderByPreference(cells, preference)
  const index = ordered.findIndex((cell) => cell.region === region)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) {
    return { ok: false, message: '该区域已经在边界位置' }
  }
  const regions = ordered.map((cell) => cell.region)
  const [moved] = regions.splice(index, 1)
  regions.splice(target, 0, moved)
  writeStore(`${ORDER_KEY_PREFIX}${shiftKey}`, regions)
  return { ok: true, message: `${region}交接格已调整` }
}

type LockishNavigator = Navigator & {
  locks?: {
    request: <T>(
      name: string,
      callback: () => T | PromiseLike<T>,
    ) => Promise<T>
  }
}

function runSealed(
  session: SessionContext,
  dateKey: string,
): { ok: boolean; message: string; snapshot?: HandoverSnapshot } {
  const shiftKey = shiftKeyOf(session.shiftLabel, dateKey)
  const storageKey = handoverStorageKey(shiftKey)

  // 并发封存：写入前再读一次，已有快照就判负，只保留首个封存版本。
  const existing = readStore<HandoverSnapshot>(storageKey)
  if (existing) {
    return {
      ok: false,
      message: `本班次已于 ${existing.sealedAt} 由 ${existing.sealedBy} 完成封存，只保留首个版本`,
    }
  }

  // 封存结论只取这一时刻的一份：格子、顺序、异常引用全部冻结。
  const liveCells = computeRegionCells(allRows())
  const order =
    loadOrder(shiftKey) ?? sortByRegionOrder(liveCells.map((cell) => cell.region))
  const cells = orderByPreference(liveCells, order).map((cell) => ({
    ...cell,
    locked: true,
    modules: cell.modules.map((stat) => ({ ...stat })),
    abnormalRefs: cell.abnormalRefs.map((ref) => ({ ...ref })),
  }))
  const sealedAt = new Date().toISOString()
  const snapshot: HandoverSnapshot = {
    shiftKey,
    shiftLabel: session.shiftLabel,
    sealedAt,
    sealedBy: session.operator,
    rulesVersion: RULES_VERSION,
    order,
    cells,
  }

  // 先落封存结论，再据同一份结论给机坪安全台账生成待办。
  writeStore(storageKey, snapshot)
  const winner = readStore<HandoverSnapshot>(storageKey)
  if (!winner || winner.sealedBy !== session.operator || winner.sealedAt !== sealedAt) {
    return {
      ok: false,
      message: '检测到并发交班，已只保留首个封存版本',
    }
  }

  createApronTodos(snapshot)
  return { ok: true, message: `交班已封存，已生成 ${cells.length} 个区域的机坪安全待办`, snapshot }
}

// 交班确认：用 Web Locks 串行化跨标签页并发封存；不支持的环境退回同步 CAS。
export async function sealHandover(
  session: SessionContext,
  dateKey: string,
): Promise<ActionResult> {
  const locks = (navigator as LockishNavigator).locks
  if (locks?.request) {
    return locks.request('airport-ground-handling:seal', () => runSealed(session, dateKey))
  }
  return runSealed(session, dateKey)
}

function nextRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 交班确认后，其它页面（机坪安全台账）要一并出现待办：
// 每个封存区域生成一条汇总待办，问题明细来自快照里冻结的同一份异常引用。
function createApronTodos(snapshot: HandoverSnapshot): void {
  const rows = listRows(APRON_SAFETY_KEY)
  let nextId = nextRowId(rows)
  const appended: EntryRow[] = []
  for (const cell of snapshot.cells) {
    const refs = cell.abnormalRefs
    const problems: string[] = []
    if (cell.pending > 0) {
      problems.push(`待处理 ${cell.pending} 条`)
    }
    if (cell.abnormal > 0) {
      problems.push(`异常 ${cell.abnormal} 条`)
    }
    if (problems.length === 0) {
      problems.push('交班巡查复核，无在办异常')
    }
    const detail = refs.length
      ? refs.map((ref: AbnormalRef) => `${ref.moduleName} ${ref.code}（${ref.status}）`).join('；')
      : '无异常明细'
    appended.push({
      id: nextId,
      status: '待巡查',
      pending: true,
      abnormal: false,
      巡查编号: `APRO-HAND-${String(nextId).padStart(4, '0')}`,
      巡查区域: cell.region === UNKNOWN_REGION ? '未归属区域（待补录机位）' : `${cell.region}机坪`,
      巡查人员: snapshot.sealedBy,
      巡查日期: snapshot.sealedAt.slice(0, 10),
      发现问题: `${snapshot.shiftLabel}交班待办：${problems.join('，')}`,
      整改措施: detail,
      复查结果: '待复查',
      安全状态: '待办',
      归属区域: cell.region,
      来源班次: snapshot.shiftKey,
    })
    nextId += 1
  }
  saveRows(APRON_SAFETY_KEY, [...rows, ...appended])
}

// 概览与保障清单共用同一份结论：导出的 CSV 直接来自当前呈现的快照/实时态势。
export function exportSituationCsv(situation: TerminalSituation): {
  filename: string
  content: string
} {
  const stamped = situation.sealedAt ? situation.sealedAt.slice(0, 10) : ''
  const lines = [
    ['班次', situation.shiftLabel, '封存时间', situation.sealedAt ?? '未封存'].join(','),
    ['规则版本', `v${situation.rulesVersion}`, '封存人', situation.sealedBy ?? '—'].join(','),
    [],
    ['区域', '业务模块数', '登记总量', '待处理', '异常量', '结论'],
  ]
  for (const cell of situation.cells) {
    const conclusion = cell.abnormal
      ? `异常 ${cell.abnormal} 条待跟进`
      : cell.pending
        ? `待处理 ${cell.pending} 条，无异常`
        : '无在办事项'
    lines.push(
      [cell.region, cell.modules.length, cell.created, cell.pending, cell.abnormal, conclusion].join(
        ',',
      ),
    )
  }
  lines.push([])
  lines.push(['异常明细'])
  lines.push(['区域', '业务模块', '编号', '当前状态'])
  for (const cell of situation.cells) {
    for (const ref of cell.abnormalRefs) {
      lines.push([cell.region, ref.moduleName, ref.code, ref.status].join(','))
    }
  }
  return {
    filename: `航站楼交接保障清单-${stamped || situation.shiftKey}.csv`,
    content: `\uFEFF${lines.join('\n')}`,
  }
}

export function downloadSituationCsv(situation: TerminalSituation): void {
  const { filename, content } = exportSituationCsv(situation)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
