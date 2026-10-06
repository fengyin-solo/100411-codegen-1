/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// ---- 航站楼态势 -------------------------------------------------------

export type AreaKey = 'T1' | 'T2'

export type AreaModuleStat = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

export type AreaStat = {
  area: AreaKey
  name: string
  created: number
  pending: number
  abnormal: number
  modules: AreaModuleStat[]
}

// ---- 交班 / 交接格 ----------------------------------------------------

export type CellMetrics = {
  created: number
  pending: number
  abnormal: number
}

export type CellSnapshot = CellMetrics & {
  ruleVersion: number
  at: string
}

/** 交班工作台里的一个格子：航站楼 × 业务模块。 */
export type BoardCell = {
  id: string
  area: AreaKey
  moduleKey: string
  order: number
  /** 值班主管给格子填写的交接说明。 */
  conclusion: string
  locked: boolean
  lockedAt?: string
  /** 锁定瞬间固化的快照；未锁格子始终按最新规则实时统计。 */
  snapshot?: CellSnapshot
}

export type BoardState = {
  ruleVersion: number
  /** CAS 令牌：封存成功即轮换，重复确认的并发提交对不上令牌就会被拒。 */
  sealToken: string
  cells: BoardCell[]
  updatedAt: string
}

export type SealedCell = CellMetrics & {
  area: AreaKey
  areaName: string
  moduleKey: string
  moduleName: string
  locked: boolean
  ruleVersion: number
  conclusion: string
}

/** 一次交班确认封存下来的版本，概览与保障清单读的都是这同一份结论。 */
export type HandoverDoc = {
  id: string
  sealedAt: string
  operator: string
  shiftLabel: string
  ruleVersion: number
  conclusion: string
  cells: SealedCell[]
  todosCreated: number
}

export type HandoverConclusion = Pick<
  HandoverDoc,
  'id' | 'sealedAt' | 'operator' | 'shiftLabel' | 'conclusion' | 'ruleVersion' | 'todosCreated'
>

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  areas: AreaStat[]
  conclusion: HandoverConclusion | null
}
