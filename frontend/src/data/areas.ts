import { MODULE_BY_KEY } from './modules'
import type { AreaKey, EntryRow } from './types'

// 区域模型：当前只有两座航站楼，后续扩容只需在这里加。
export const AREAS: { key: AreaKey; name: string }[] = [
  { key: 'T1', name: '1号航站楼' },
  { key: 'T2', name: '2号航站楼' },
]

export const AREA_NAME: Record<AreaKey, string> = {
  T1: '1号航站楼',
  T2: '2号航站楼',
}

// 机位 → 航站楼主数据（P1 直查用）。廊桥、电源、设备这类引用机位的记录靠它定位。
const STAND_AREA: Record<string, AreaKey> = {
  'T1-101': 'T1',
  'T1-102': 'T1',
  'T1-103': 'T1',
  'T2-201': 'T2',
  'T2-202': 'T2',
  'T2-203': 'T2',
}

// 航班 → 机位（P2 反查用）：航班类记录没有机位列，先落到机位再落到航站楼。
const FLIGHT_STAND: Record<string, string> = {
  CA1831: 'T1-101',
  MU5102: 'T1-102',
  CZ3105: 'T1-103',
  HU7801: 'T2-201',
  CA1208: 'T2-202',
  MU5617: 'T2-203',
}

// P3：字段文本里能识别出的航站楼线索。
const AREA_PATTERNS: { area: AreaKey; pattern: RegExp }[] = [
  { area: 'T1', pattern: /(^|[^0-9A-Z])T1([^0-9]|$)|1号航站|T1候机|T1廊桥|T1机位|T1机坪|T1飞行区|T1待\s*命/i },
  { area: 'T2', pattern: /(^|[^0-9A-Z])T2([^0-9]|$)|2号航站|T2候机|T2廊桥|T2机位|T2机坪|T2飞行区|T2待\s*命/i },
]

// P4：连文本线索都没有的模块兜底归属。车辆、排班、设备类模块在 T1 基地集中待命。
const MODULE_FALLBACK: Record<string, AreaKey> = {
  crew_schedule: 'T1',
  special_vehicle: 'T1',
  load_equip: 'T1',
}

const DEFAULT_AREA: AreaKey = 'T1'

/** 引用「所属机位 / 推出机位 / 安装位置」的字段，能直接解析机位。 */
const STAND_FIELDS = ['所属机位', '推出机位', '安装位置']
/** 引用航班的字段，航班能反查到机位。 */
const FLIGHT_FIELDS = ['匹配航班', '关联航班', '涉及航班']
/** 兜底文本扫描字段（区域巡查、事发位置等）。 */
const TEXT_FIELDS = [
  '巡查区域',
  '事发位置',
  '调度人员',
  '所属班组',
  '装卸班组',
  '清洁班组',
  '备注说明',
]

export function isAreaKey(value: unknown): value is AreaKey {
  return value === 'T1' || value === 'T2'
}

function lookupStand(code: string): AreaKey | undefined {
  const hit = Object.keys(STAND_AREA).find((stand) => code.includes(stand))
  return hit ? STAND_AREA[hit] : undefined
}

function lookupFlight(code: string): AreaKey | undefined {
  const hit = Object.keys(FLIGHT_STAND).find((flight) => code.includes(flight))
  return hit ? STAND_AREA[FLIGHT_STAND[hit]] : undefined
}

function matchText(value: string): AreaKey | undefined {
  for (const { area, pattern } of AREA_PATTERNS) {
    if (pattern.test(value)) {
      return area
    }
  }
  return undefined
}

/**
 * 存量记录航站楼归属回填，优先级由高到低：
 * P1 机位主数据直查（所属机位/推出机位/安装位置）
 * P2 航班反查机位（匹配/关联/涉及航班 → 航班机位表）
 * P3 字段文本里的航站楼线索（巡查区域、事发位置、班组等）
 * P4 模块级兜底 → 全局 T1
 * 返回归属与命中的优先级，低优先级回填的格子在界面上可识别、可纠正。
 */
export function resolveArea(moduleKey: string, row: EntryRow): { area: AreaKey; via: 'P1' | 'P2' | 'P3' | 'P4' } {
  const values = (fields: string[]): string[] =>
    fields.map((field) => String(row[field] ?? '')).filter((value) => value.trim() !== '')

  for (const value of values(STAND_FIELDS)) {
    const area = lookupStand(value)
    if (area) {
      return { area, via: 'P1' }
    }
  }
  for (const value of values(FLIGHT_FIELDS)) {
    const area = lookupFlight(value)
    if (area) {
      return { area, via: 'P2' }
    }
  }
  for (const value of values(TEXT_FIELDS)) {
    const area = matchText(value)
    if (area) {
      return { area, via: 'P3' }
    }
  }
  const fallback = MODULE_FALLBACK[moduleKey] ?? DEFAULT_AREA
  return { area: fallback, via: 'P4' }
}

const VIA_LABEL: Record<'P1' | 'P2' | 'P3' | 'P4', string> = {
  P1: '机位归属',
  P2: '航班反查',
  P3: '区域线索',
  P4: '兜底归属',
}

export function areaViaLabel(via: 'P1' | 'P2' | 'P3' | 'P4'): string {
  return VIA_LABEL[via]
}

/** 迁移/重置后给缺归属的记录补上「所属航站楼」，已经有合法航站楼的不动。 */
export function enrichRows(moduleKey: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(moduleKey)
  const canAttach = Boolean(meta && meta.fields.includes('所属航站楼'))
  return rows.map((row) => {
    if (isAreaKey(row['所属航站楼']) || AREAS.some((item) => item.name === row['所属航站楼'])) {
      return row
    }
    const { area } = resolveArea(moduleKey, row)
    if (canAttach) {
      return { ...row, 所属航站楼: AREA_NAME[area] }
    }
    return row
  })
}
