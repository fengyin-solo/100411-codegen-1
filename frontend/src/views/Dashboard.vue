<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">按航站楼汇总保障态势，并在同一页完成值班主管交班；概览与保障清单共用同一份封存结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <RouterLink class="btn" to="/handover">打开保障清单</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div v-if="conclusion" class="conclusion-banner">
      <div>
        最近交班结论（{{ conclusion.id }}）：{{ conclusion.conclusion }}
      </div>
      <div class="meta">
        {{ conclusion.sealedAt }} · {{ conclusion.operator }} · {{ conclusion.shiftLabel }}
        · 规则 v{{ conclusion.ruleVersion }} · 机坪安全台账已生成 {{ conclusion.todosCreated }} 条待办
        <RouterLink :to="`/handover?doc=${conclusion.id}`" class="link" style="margin-left:8px">查看保障清单</RouterLink>
      </div>
    </div>

    <nav class="tab-bar">
      <button class="tab-btn" :class="{ active: tab === 'modules' }" type="button" @click="tab = 'modules'">
        业务模块汇总
      </button>
      <button class="tab-btn" :class="{ active: tab === 'areas' }" type="button" @click="tab = 'areas'">
        航站楼态势
      </button>
      <button class="tab-btn" :class="{ active: tab === 'board' }" type="button" @click="openBoard">
        交班工作台
      </button>
    </nav>

    <!-- 业务模块汇总 -->
    <table v-if="tab === 'modules'" class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td :class="{ 'num-pending': row.pending > 0 }">{{ row.pending }}</td>
          <td :class="{ 'num-warn': row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 航站楼态势：业务模块汇总、登记总量、待处理、异常量按区域列出 -->
    <div v-else-if="tab === 'areas'">
      <p class="status-legend">
        <span class="legend-item">统计口径：{{ currentRuleLabel }}</span>
        <span class="legend-item">已锁格子的历史快照在交班工作台查看</span>
      </p>
      <div v-for="area in areas" :key="area.area" class="area-block">
        <div class="area-head">
          <h3>{{ area.name }}</h3>
          <div class="area-sum">
            <span>登记 <b>{{ area.created }}</b></span>
            <span>待处理 <b :class="{ 'num-pending': area.pending > 0 }">{{ area.pending }}</b></span>
            <span>异常 <b :class="{ 'num-warn': area.abnormal > 0 }">{{ area.abnormal }}</b></span>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in area.modules" :key="`${area.area}-${item.key}`">
              <td>{{ item.name }}</td>
              <td>{{ item.created }}</td>
              <td :class="{ 'num-pending': item.pending > 0 }">{{ item.pending }}</td>
              <td :class="{ 'num-warn': item.abnormal > 0 }">{{ item.abnormal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 交班工作台 -->
    <div v-else>
      <div class="board-toolbar">
        <label>统计规则版本：</label>
        <select :value="ruleVersion" class="btn" @change="changeRule(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="rule in ruleVersions" :key="rule.version" :value="rule.version">
            {{ rule.label }}
          </option>
        </select>
        <span class="page-desc" style="margin:0">{{ ruleVersionDesc }}</span>
        <span class="page-desc" style="margin:0">换版只重算未锁格子，已锁快照不改写。</span>
      </div>

      <div class="board-grid">
        <article
          v-for="cell in boardCells"
          :key="cell.id"
          class="board-cell"
          :class="{ locked: cell.locked, stale: cell.stale }"
        >
          <div class="cell-head">
            <span class="cell-title">{{ cell.areaName }} · {{ cell.moduleName }}</span>
            <span v-if="cell.locked" class="cell-tag locked-tag">{{ cell.stale ? '历史快照' : '已锁' }}</span>
            <span v-else-if="cell.stale" class="cell-tag stale-tag">待重算</span>
            <span v-else class="cell-tag">实时</span>
          </div>
          <div class="cell-metrics">
            <span>登记 <b>{{ cell.metrics.created }}</b></span>
            <span>待处理 <b :class="{ 'num-pending': cell.metrics.pending > 0 }">{{ cell.metrics.pending }}</b></span>
            <span>异常 <b :class="{ 'num-warn': cell.metrics.abnormal > 0 }">{{ cell.metrics.abnormal }}</b></span>
          </div>
          <div v-if="cell.locked && cell.snapshot" class="page-desc" style="margin:0">
            快照时间 {{ cell.snapshot.at }} · 规则 v{{ cell.snapshot.ruleVersion }}
          </div>
          <input
            class="cell-note"
            :value="cell.conclusion"
            placeholder="交接说明（可选）"
            @input="updateConclusion(cell.id, ($event.target as HTMLInputElement).value)"
          />
          <div class="cell-actions">
            <button class="link" type="button" @click="move(cell.id, -1)">上移</button>
            <button class="link" type="button" @click="move(cell.id, 1)">下移</button>
            <button class="link" type="button" @click="toggleLock(cell.id)">
              {{ cell.locked ? '解锁重算' : '锁定快照' }}
            </button>
          </div>
        </article>
      </div>

      <div class="seal-box">
        <h3 style="margin:0 0 8px;font-size:14px">交班确认</h3>
        <textarea v-model="sealConclusion" placeholder="交接结论"></textarea>
        <div class="board-toolbar" style="margin:8px 0 0">
          <button class="btn primary" type="button" @click="confirmSeal">交班确认并封存</button>
          <button class="btn" type="button" @click="simulateRivalSeal">模拟另一标签页并发封存</button>
          <span class="page-desc" style="margin:0">
            封存后：机坪安全台账按有数据的格子生成待办；同版本并发确认只保留首个，后到的会被拒绝。
          </span>
        </div>
      </div>
    </div>

    <p v-if="errorMessage" class="error-text" style="margin-top:10px">{{ errorMessage }}</p>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import {
  currentRuleVersion,
  defaultConclusion,
  draftToken,
  listBoardCells,
  moveCell,
  sealHandover,
  setCellConclusion,
  switchRuleVersion,
  toggleCellLock,
  type BoardCellView,
} from '@/api/handover'
import { RULE_VERSIONS } from '@/data/stats'
import { storageKeys } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { OverviewResult } from '@/data/types'

const store = useSessionStore()

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const areas = ref<OverviewResult['areas']>([])
const conclusion = ref<OverviewResult['conclusion']>(null)
const boardCells = ref<BoardCellView[]>([])
const ruleVersion = ref(currentRuleVersion())
const sealToken = ref(draftToken())
const sealConclusion = ref(defaultConclusion())
const errorMessage = ref('')
const tab = ref<'modules' | 'areas' | 'board'>('areas')

const ruleVersions = RULE_VERSIONS
const currentRuleLabel = computed(
  () => ruleVersions.find((rule) => rule.version === ruleVersion.value)?.label ?? `v${ruleVersion.value}`,
)
const ruleVersionDesc = computed(
  () => ruleVersions.find((rule) => rule.version === ruleVersion.value)?.desc ?? '',
)

function refreshOverview() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  areas.value = payload.areas
  conclusion.value = payload.conclusion
}

function refreshBoard() {
  boardCells.value = listBoardCells()
  ruleVersion.value = currentRuleVersion()
  sealToken.value = draftToken()
}

function refresh() {
  errorMessage.value = ''
  refreshOverview()
  refreshBoard()
}

function openBoard() {
  tab.value = 'board'
  refreshBoard()
}

function move(id: string, direction: -1 | 1) {
  const result = moveCell(id, direction)
  errorMessage.value = result.ok ? '' : result.message
  refreshBoard()
}

function toggleLock(id: string) {
  const result = toggleCellLock(id)
  errorMessage.value = result.ok ? '' : result.message
  refreshBoard()
  refreshOverview()
}

function updateConclusion(id: string, value: string) {
  setCellConclusion(id, value)
}

function changeRule(version: number) {
  const result = switchRuleVersion(version)
  errorMessage.value = result.ok ? '' : result.message
  refreshBoard()
  refreshOverview()
}

function confirmSeal() {
  errorMessage.value = ''
  const result = sealHandover({
    token: sealToken.value,
    operator: store.operator,
    shiftLabel: store.shiftLabel,
    conclusion: sealConclusion.value,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    // CAS 失败说明草稿已被别处封存，刷新拿新令牌与结论。
    refresh()
    return
  }
  sealConclusion.value = defaultConclusion()
  refresh()
}

// 纯前端没有真正的并发请求：模拟另一标签页用当前草稿令牌抢先封存。
// 同一文档内写入不会触发 storage 事件，本页持有的令牌就此失效，
// 再点「交班确认」就会被「只保留首个版本」的 CAS 挡住，与跨标签页效果一致。
function simulateRivalSeal() {
  const result = sealHandover({
    token: draftToken(),
    operator: '另一标签页主管',
    shiftLabel: '并发班次',
    conclusion: '另一标签页抢先封存的结论',
  })
  if (result.ok) {
    errorMessage.value = `另一标签页已抢先封存 ${result.doc?.id}，本页令牌已失效，请再点交班确认验证拒绝效果`
  } else {
    errorMessage.value = result.message
  }
}

function onStorageChange(event: StorageEvent) {
  const keys = storageKeys()
  if (event.key === keys.board || event.key === keys.handovers || event.key === keys.entries) {
    refresh()
  }
}

onMounted(() => {
  refresh()
  window.addEventListener('storage', onStorageChange)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange)
})
</script>
