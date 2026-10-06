import { resolveArea } from './areas'
import type { CellMetrics, EntryRow } from './types'

// 统计规则版本：换版只重算尚未锁定的格子，已锁格子保留封存时的快照。
export const RULE_VERSIONS = [
  {
    version: 1,
    label: 'v1 规则（沿用至今）',
    desc: '待处理=流转未到终态；异常量=记录被异常动作标记。',
  },
  {
    version: 2,
    label: 'v2 规则（2026-10 换版）',
    desc: '待处理同 v1；异常量追加显式异常状态（异常滞留/中断、故障、超时、待整改等）。',
  },
] as const

// v2 新口径：这些状态本身就是异常，不再依赖是否点过「停用/标记异常」。
const ABNORMAL_STATUSES_V2 = new Set([
  '异常滞留',
  '异常中断',
  '故障停用',
  '设备异常',
  '已超时',
  '已延误',
  '待整改',
  '已报修',
  '已取消',
])

function isAbnormal(row: EntryRow, version: number): boolean {
  if (Boolean(row.abnormal)) {
    return true
  }
  if (version >= 2 && ABNORMAL_STATUSES_V2.has(String(row.status))) {
    return true
  }
  return false
}

export function latestRuleVersion(): number {
  return RULE_VERSIONS[RULE_VERSIONS.length - 1].version
}

/** 按规则版本实时统计一组记录。 */
export function computeMetrics(rows: EntryRow[], version: number): CellMetrics {
  return {
    created: rows.length,
    pending: rows.filter((row) => Boolean(row.pending)).length,
    abnormal: rows.filter((row) => isAbnormal(row, version)).length,
  }
}

/** 航站楼 × 业务模块格子的实时指标。 */
export function computeCellMetrics(
  moduleKey: string,
  rows: EntryRow[],
  area: 'T1' | 'T2',
  version: number,
): CellMetrics {
  const scoped = rows.filter((row) => resolveArea(moduleKey, row).area === area)
  return computeMetrics(scoped, version)
}
