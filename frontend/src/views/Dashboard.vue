<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块关键指标；航站楼态势按区域交接格呈现，交班封存后整盘冻结。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn" type="button" @click="exportList">导出保障清单</button>
        <button
          v-if="!situation?.sealed"
          class="btn primary"
          type="button"
          :disabled="sealing"
          @click="confirmSeal"
        >
          {{ sealing ? '封存中…' : '交班确认并封存' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div class="situation-bar">
      <div class="situation-meta">
        <span class="badge" :class="situation?.sealed ? 'badge-locked' : 'badge-live'">
          {{ situation?.sealed ? '已封存快照' : '实时统计中' }}
        </span>
        <span>当前班次：{{ session.shiftLabel }}（{{ todayKey }}）</span>
        <span>统计规则：v{{ situation?.rulesVersion ?? '—' }}</span>
        <span v-if="situation?.sealed">
          封存人：{{ situation.sealedBy }} · {{ formatTime(situation.sealedAt) }}
        </span>
        <span v-if="situation?.viewingHistory" class="warn-text">正在查看历史班次快照</span>
      </div>
      <label class="history-pick" v-if="situation?.history.length">
        <span>历史交班</span>
        <select :value="viewShiftKey" @change="onPickHistory">
          <option value="">当前班次</option>
          <option v-for="item in situation.history" :key="item.shiftKey" :value="item.shiftKey">
            {{ item.sealedAt.slice(0, 16).replace('T', ' ') }} {{ item.shiftLabel }}（{{ item.sealedBy }}）
          </option>
        </select>
      </label>
    </div>

    <h3 class="block-title">航站楼态势交接格</h3>
    <div class="region-grid">
      <article
        v-for="(cell, index) in situation?.cells ?? []"
        :key="cell.region"
        class="region-card"
        :class="{ 'region-locked': cell.locked }"
      >
        <header class="region-head">
          <strong>{{ cell.region }}</strong>
          <span class="region-flags">
            <span class="tag" :class="cell.locked ? 'tag-locked' : 'tag-live'">
              {{ cell.locked ? `已锁 v${cell.rulesVersion}` : `未锁 v${cell.rulesVersion}` }}
            </span>
            <button
              v-if="!cell.locked"
              class="link"
              type="button"
              :disabled="index === 0"
              title="前移交接格"
              @click="move(cell.region, -1)"
            >↑</button>
            <button
              v-if="!cell.locked"
              class="link"
              type="button"
              :disabled="index === (situation?.cells.length ?? 1) - 1"
              title="后移交接格"
              @click="move(cell.region, 1)"
            >↓</button>
          </span>
        </header>
        <div class="region-metrics">
          <div><span>业务模块</span><strong>{{ cell.modules.length }}</strong></div>
          <div><span>登记总量</span><strong>{{ cell.created }}</strong></div>
          <div><span>待处理</span><strong class="metric-pending">{{ cell.pending }}</strong></div>
          <div><span>异常量</span><strong class="metric-abnormal">{{ cell.abnormal }}</strong></div>
        </div>
        <ul class="region-modules">
          <li v-for="stat in cell.modules" :key="stat.key">
            <span>{{ stat.name }}</span>
            <span class="region-module-nums">
              {{ stat.created }} / <em class="metric-pending">{{ stat.pending }}</em> /
              <em class="metric-abnormal">{{ stat.abnormal }}</em>
            </span>
          </li>
        </ul>
        <details v-if="cell.abnormalRefs.length" class="region-detail">
          <summary>异常明细（{{ cell.abnormalRefs.length }}）</summary>
          <RouterLink
            v-for="ref in cell.abnormalRefs"
            :key="`${ref.moduleKey}-${ref.id}`"
            class="abnormal-ref"
            :to="`/${ref.moduleKey}`"
          >
            {{ ref.moduleName }} · {{ ref.code }} · {{ ref.status }}
          </RouterLink>
        </details>
      </article>
    </div>
    <p class="hint-text">
      每个模块行尾三个数依次为 登记总量 / 待处理 / 异常量；规则换版时仅刷新「未锁」格，已封存快照不改写。
    </p>

    <h3 class="block-title">业务模块汇总</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里；交班封存跨标签页并发时只保留首个版本</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  downloadSituationCsv,
  loadOverview,
  loadTerminalSituation,
  moveTerminalCell,
  sealHandover,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { OverviewResult, TerminalSituation } from '@/data/types'

const session = useSessionStore()

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const situation = ref<TerminalSituation | null>(null)
const viewShiftKey = ref('')
const sealing = ref(false)
const message = ref('')
const messageOk = ref(false)

const todayKey = new Date().toISOString().slice(0, 10)

function sessionContext() {
  return { operator: session.operator, shiftLabel: session.shiftLabel }
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  situation.value = loadTerminalSituation(sessionContext(), todayKey, viewShiftKey.value || undefined)
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function move(region: string, direction: -1 | 1) {
  const result = moveTerminalCell(sessionContext(), todayKey, region, direction)
  notify(result.ok, result.message)
  if (result.ok) {
    refresh()
  }
}

async function confirmSeal() {
  if (!window.confirm('交班确认后将封存当前整盘结论，并在机坪安全台账生成各区域待办，且不可改写。确认继续？')) {
    return
  }
  sealing.value = true
  try {
    const result = await sealHandover(sessionContext(), todayKey)
    notify(result.ok, result.message)
    if (result.ok) {
      viewShiftKey.value = ''
      refresh()
    }
  } finally {
    sealing.value = false
  }
}

function onPickHistory(event: Event) {
  viewShiftKey.value = (event.target as HTMLSelectElement).value
  refresh()
}

function exportList() {
  if (situation.value) {
    downloadSituationCsv(situation.value)
  }
}

function formatTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : ''
}

onMounted(refresh)
</script>
