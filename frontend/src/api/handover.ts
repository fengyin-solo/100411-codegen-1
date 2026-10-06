import { MODULES } from '@/data/modules'
import { AREA_NAME, AREAS } from '@/data/areas'
import {
  appendHandover,
  listRows,
  loadBoard,
  loadHandovers,
  saveBoard,
  saveRows,
} from '@/data/local-store'
import { computeCellMetrics, latestRuleVersion } from '@/data/stats'
import type {
  ActionResult,
  BoardCell,
  BoardState,
  CellMetrics,
  CellSnapshot,
  EntryRow,
  HandoverConclusion,
  HandoverDoc,
  SealedCell,
} from '@/data/types'

const DEFAULT_CONCLUSION = '各航站楼保障节点总体平稳，异常与待处理项已按下表交接，请接班主管逐项盯办闭环。'

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function newToken(): string {
  return `seal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cellId(area: string, moduleKey: string): string {
  return `${area}:${moduleKey}`
}

/** 工作台初始格子：航站楼 × 业务模块，按航站楼、模块清单顺序排列。 */
function initialBoard(): BoardState {
  const cells: BoardCell[] = []
  let order = 0
  for (const area of AREAS) {
    for (const meta of MODULES) {
      cells.push({
        id: cellId(area.key, meta.key),
        area: area.key,
        moduleKey: meta.key,
        order: order++,
        conclusion: '',
        locked: false,
      })
    }
  }
  return {
    ruleVersion: latestRuleVersion(),
    sealToken: newToken(),
    cells,
    updatedAt: nowText(),
  }
}

/** 读取草稿；首次进入时创建并落库，模块扩容时把缺的格子补齐（不影响已有排序与锁定）。 */
export function getBoard(): BoardState {
  const stored = loadBoard()
  if (!stored) {
    const created = initialBoard()
    saveBoard(created)
    return created
  }
  const existingIds = new Set(stored.cells.map((cell) => cell.id))
  const additions: BoardCell[] = []
  for (const area of AREAS) {
    for (const meta of MODULES) {
      const id = cellId(area.key, meta.key)
      if (!existingIds.has(id)) {
        additions.push({
          id,
          area: area.key,
          moduleKey: meta.key,
          order: stored.cells.length + additions.length,
          conclusion: '',
          locked: false,
        })
      }
    }
  }
  if (additions.length > 0) {
    const merged = { ...stored, cells: [...stored.cells, ...additions] }
    saveBoard(merged)
    return merged
  }
  return stored
}

function persist(board: BoardState): void {
  saveBoard({ ...board, updatedAt: nowText() })
}

export type BoardCellView = BoardCell & {
  moduleName: string
  areaName: string
  /** 已锁格子读快照，未锁格子按当前规则实时统计。 */
  metrics: CellMetrics
  stale: boolean
}

function viewOf(board: BoardState, cell: BoardCell): BoardCellView {
  const metrics = cell.locked && cell.snapshot
    ? { created: cell.snapshot.created, pending: cell.snapshot.pending, abnormal: cell.snapshot.abnormal }
    : computeCellMetrics(cell.moduleKey, listRows(cell.moduleKey), cell.area, board.ruleVersion)
  return {
    ...cell,
    moduleName: MODULES.find((meta) => meta.key === cell.moduleKey)?.name ?? cell.moduleKey,
    areaName: AREA_NAME[cell.area],
    metrics,
    // 已锁格子固化的规则版本若与当前换版不一致，就是历史快照，明确标出来不改写。
    stale: Boolean(cell.locked && cell.snapshot && cell.snapshot.ruleVersion !== board.ruleVersion),
  }
}

export function listBoardCells(): BoardCellView[] {
  const board = getBoard()
  return [...board.cells]
    .sort((a, b) => a.order - b.order)
    .map((cell) => viewOf(board, cell))
}

/** 值班主管排列交接格：相邻交换，只动 order。 */
export function moveCell(id: string, direction: -1 | 1): ActionResult {
  const board = getBoard()
  const ordered = [...board.cells].sort((a, b) => a.order - b.order)
  const index = ordered.findIndex((cell) => cell.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) {
    return { ok: false, message: '已经到边界，没法再移动了' }
  }
  const a = ordered[index]
  const b = ordered[target]
  const cells = board.cells.map((cell) => {
    if (cell.id === a.id) {
      return { ...cell, order: b.order }
    }
    if (cell.id === b.id) {
      return { ...cell, order: a.order }
    }
    return cell
  })
  persist({ ...board, cells })
  return { ok: true, message: `已${direction < 0 ? '上移' : '下移'}交接格` }
}

export function setCellConclusion(id: string, conclusion: string): ActionResult {
  const board = getBoard()
  const cells = board.cells.map((cell) => (cell.id === id ? { ...cell, conclusion } : cell))
  if (cells.length !== board.cells.length) {
    return { ok: false, message: '没有找到这个交接格' }
  }
  persist({ ...board, cells })
  return { ok: true, message: '交接说明已保存' }
}

function snapshotNow(version: number): (cell: BoardCell) => CellSnapshot {
  const stamp = nowText()
  return (cell: BoardCell): CellSnapshot => {
    const metrics = computeCellMetrics(cell.moduleKey, listRows(cell.moduleKey), cell.area, version)
    return { ...metrics, ruleVersion: version, at: stamp }
  }
}

/** 锁定/解锁格子。锁定瞬间按当前规则拍快照。 */
export function toggleCellLock(id: string): ActionResult {
  const board = getBoard()
  const cell = board.cells.find((item) => item.id === id)
  if (!cell) {
    return { ok: false, message: '没有找到这个交接格' }
  }
  const takeSnapshot = snapshotNow(board.ruleVersion)
  const cells = board.cells.map((item) => {
    if (item.id !== id) {
      return item
    }
    if (item.locked) {
      const { snapshot: _snapshot, lockedAt: _lockedAt, ...rest } = item
      return { ...rest, locked: false }
    }
    return { ...item, locked: true, lockedAt: nowText(), snapshot: takeSnapshot(item) }
  })
  persist({ ...board, cells })
  return { ok: true, message: cell.locked ? '格子已解锁，将跟随换版重算' : '格子已锁定，快照不再被规则换版改写' }
}

/**
 * 统计规则换版：只更新尚未锁定的格子；
 * 已锁格子保留封存时快照（stale 置位用于界面提示），等值班主管主动解锁才重算。
 */
export function switchRuleVersion(version: number): ActionResult {
  const board = getBoard()
  if (version === board.ruleVersion) {
    return { ok: false, message: `当前已经是 ${version} 版统计规则` }
  }
  persist({ ...board, ruleVersion: version })
  return { ok: true, message: `已切换到 ${version} 版统计规则，已锁格子保留快照未改写` }
}

export function currentRuleVersion(): number {
  return getBoard().ruleVersion
}

// ---- 机坪安全台账：交班待办 ------------------------------------------

function nextApronId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 交班确认后，其它页面的机坪安全台账一并生成待办：
 * 每个「有待处理或异常」的格子生成一条待巡查记录，挂上航站楼、模块、版本号，可追溯。
 */
function createApronTodos(docId: string, cells: SealedCell[]): number {
  const rows = listRows('apron_safety')
  const next = [...rows]
  let seq = nextApronId(rows)
  let created = 0
  for (const cell of cells) {
    if (cell.pending === 0 && cell.abnormal === 0) {
      continue
    }
    const tag = `${cell.areaName}·${cell.moduleName}`
    next.push({
      id: seq++,
      status: '待巡查',
      pending: true,
      abnormal: false,
      巡查编号: `APRO-HO-${docId.slice(-6)}-${cell.area}-${cell.moduleKey.slice(0, 4)}`.toUpperCase(),
      巡查区域: `${cell.areaName}（${cell.moduleName}交接）`,
      巡查人员: '接班主管分派',
      巡查日期: new Date().toISOString().slice(0, 10),
      发现问题: `交班待办：待处理 ${cell.pending} 项、异常 ${cell.abnormal} 项`,
      整改措施: cell.conclusion || '按交班结论跟进闭环',
      复查结果: `交班版本 ${docId}（规则v${cell.ruleVersion}）`,
      安全状态: `交班待办·${tag}`,
      来源交班: docId,
    } satisfies EntryRow)
    created += 1
  }
  if (created > 0) {
    saveRows('apron_safety', next)
  }
  return created
}

export type SealResult = ActionResult & { doc?: HandoverDoc }

/**
 * 交班确认（封存）：
 * - CAS：携带的 token 必须与草稿一致；并发的第二个确认（含另一标签页先封存的情况）
 *   token 已轮换，直接拒绝，只保留首个版本。
 * - 封存时所有格子按当前规则拍快照，已锁格子沿用各自快照。
 * - 封存后机坪安全台账生成待办，草稿开新一轮。
 */
export function sealHandover(input: { token: string; operator: string; shiftLabel: string; conclusion: string }): SealResult {
  const board = getBoard()
  if (input.token !== board.sealToken) {
    return {
      ok: false,
      message: '交班已被另一位主管确认封存，当前版本只保留首个封存结果，请刷新后查看',
    }
  }

  const version = board.ruleVersion
  const takeSnapshot = snapshotNow(version)
  const sealedAt = nowText()
  const ordered = [...board.cells].sort((a, b) => a.order - b.order)
  const sealedCells: SealedCell[] = ordered.map((cell) => {
    const snapshot = cell.locked && cell.snapshot ? cell.snapshot : takeSnapshot(cell)
    return {
      area: cell.area,
      areaName: AREA_NAME[cell.area],
      moduleKey: cell.moduleKey,
      moduleName: MODULES.find((meta) => meta.key === cell.moduleKey)?.name ?? cell.moduleKey,
      locked: cell.locked,
      created: snapshot.created,
      pending: snapshot.pending,
      abnormal: snapshot.abnormal,
      ruleVersion: snapshot.ruleVersion,
      conclusion: cell.conclusion,
    }
  })

  const docId = `HO${Date.now().toString(36).toUpperCase()}`
  const doc: HandoverDoc = {
    id: docId,
    sealedAt,
    operator: input.operator || '值班主管',
    shiftLabel: input.shiftLabel,
    ruleVersion: version,
    conclusion: input.conclusion || DEFAULT_CONCLUSION,
    cells: sealedCells,
    todosCreated: 0,
  }
  doc.todosCreated = createApronTodos(docId, sealedCells)

  appendHandover(doc)
  // 封存成功立即轮换令牌并开出新一轮空白草稿，后到的并发确认必然 CAS 失败。
  persist({ ...initialBoard(), sealToken: newToken() })
  return { ok: true, message: `交班 ${docId} 已封存，机坪安全台账生成 ${doc.todosCreated} 条待办`, doc }
}

export function draftToken(): string {
  return getBoard().sealToken
}

export function listHandovers(): HandoverDoc[] {
  return loadHandovers()
}

export function latestHandover(): HandoverDoc | null {
  return loadHandovers()[0] ?? null
}

export function latestConclusion(): HandoverConclusion | null {
  const doc = latestHandover()
  if (!doc) {
    return null
  }
  return {
    id: doc.id,
    sealedAt: doc.sealedAt,
    operator: doc.operator,
    shiftLabel: doc.shiftLabel,
    ruleVersion: doc.ruleVersion,
    conclusion: doc.conclusion,
    todosCreated: doc.todosCreated,
  }
}

export function defaultConclusion(): string {
  return DEFAULT_CONCLUSION
}

/** 保障清单导出：与概览共用同一份封存结论。 */
export function exportHandover(doc: HandoverDoc): { filename: string; content: string } {
  const header = ['航站楼', '业务模块', '登记总量', '待处理', '异常量', '锁定', '规则版本', '交接说明']
  const lines = [header.join(',')]
  for (const cell of doc.cells) {
    lines.push(
      [
        cell.areaName,
        cell.moduleName,
        cell.created,
        cell.pending,
        cell.abnormal,
        cell.locked ? '已锁快照' : '封存时统计',
        `v${cell.ruleVersion}`,
        cell.conclusion || '—',
      ]
        .map((value) => String(value).replace(/,/g, '，'))
        .join(','),
    )
  }
  return {
    filename: `保障清单-${doc.id}.csv`,
    content: `﻿交班版本,${doc.id}\n交班时间,${doc.sealedAt}\n交班主管,${doc.operator}\n班次,${doc.shiftLabel}\n交接结论,${doc.conclusion}\n机坪待办,${doc.todosCreated}条\n\n${lines.join('\n')}`,
  }
}
