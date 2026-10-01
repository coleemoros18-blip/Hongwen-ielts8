<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db } from '../services/db'
import { startStudyMusic } from '../services/studyMusic'
import { useAppStore } from '../stores/app'
import type { Bank, StudyGroup } from '../types'
type Row = StudyGroup & { bankName: string }
const router = useRouter(), route = useRoute(), store = useAppStore(), bankFilter = ref('all'), rows = ref<Row[]>([]), loading = ref(false)
const completedReview = computed(() => {
  const groupNumber = Number(route.query.completedGroup), nextReviewAt = String(route.query.nextReviewAt ?? '')
  return groupNumber > 0 && Number.isFinite(Date.parse(nextReviewAt)) ? { groupNumber, nextReviewAt: new Date(nextReviewAt).toLocaleString() } : null
})
const today = new Date(); today.setHours(0,0,0,0)
function dayOffset(iso: string) { const date = new Date(iso); date.setHours(0,0,0,0); return Math.round((date.getTime()-today.getTime())/86400000) }
const dueToday = computed(() => rows.value.filter(row => dayOffset(row.nextReviewAt) <= 0))
const upcoming = computed(() => {
  const buckets = new Map<number, Row[]>()
  for (const row of rows.value) { const days = dayOffset(row.nextReviewAt); if (days > 0) buckets.set(days, [...(buckets.get(days) ?? []), row]) }
  return [...buckets.entries()].sort(([a],[b]) => a-b)
})
const allGroups = computed(() => [...rows.value].sort((a,b) => a.nextReviewAt.localeCompare(b.nextReviewAt)))
async function load() {
  loading.value = true
  try {
    const [groups, banks] = await Promise.all([db.studyGroups.toArray(), db.banks.toArray()])
    const names = new Map(banks.map(bank => [bank.id, bank.name]))
    rows.value = groups.filter(group => bankFilter.value === 'all' || group.bankId === bankFilter.value).map(group => ({ ...group, bankName: names.get(group.bankId) ?? '已删除的句库' }))
  } finally { loading.value = false }
}
function open(row: Row) { void startStudyMusic(); store.setBank(row.bankId); void router.push(`/banks/${row.bankId}/browse?groupId=${encodeURIComponent(row.id)}&mode=review`) }
onMounted(load); watch(bankFilter, load)
</script>

<template>
  <section class="section-heading"><div><span class="eyebrow">SPACED REVIEW</span><h2>强化复习</h2><p>按艾宾浩斯间隔安排已初记的整组内容。到期优先，也可提前复习。</p></div><select v-model="bankFilter" class="review-filter"><option value="all">所有句库</option><option v-for="bank in store.banks" :key="bank.id" :value="bank.id">{{ bank.name }}</option></select></section>
  <section v-if="completedReview" class="group-completion-notice review-completion-notice"><div><b>第 {{ completedReview.groupNumber }} 组强化复习完成</b><p>复习进度已保存，下次复习时间：{{ completedReview.nextReviewAt }}。该组已从今天待复习列表重新排入后续计划。</p></div></section>
  <section class="review-summary"><div><small>今日应复习</small><b>{{ dueToday.length }} 组</b></div><div><small>计划中的组</small><b>{{ rows.length }} 组</b></div><div><small>复习间隔</small><b>1 · 2 · 4 · 7 · 15 · 30 天</b></div></section>
  <section class="panel review-bucket"><div class="panel-heading"><div><span class="eyebrow">DUE NOW</span><h3>今天需要复习</h3></div><span class="pill" :class="dueToday.length?'pill-fuzzy':'pill-learning'">{{ dueToday.length }} 组</span></div><div v-if="dueToday.length" class="review-group-list"><button v-for="row in dueToday" :key="row.id" class="review-group-row" @click="open(row)"><span class="review-date overdue">{{ dayOffset(row.nextReviewAt)<0?'已逾期':'今天' }}</span><span class="review-group-main"><b>{{ row.bankName }} · 第 {{ row.groupNumber }} 组</b><small>{{ row.sentenceIds.length }} 句 · 已复习 {{ row.reviewCount }} 次</small></span><span class="text-link">开始复习 →</span></button></div><p v-else class="review-empty">今天没有到期的组。可以看看后面的复习计划，或继续去“初记”学习新组。</p></section>
  <section class="panel review-bucket"><div class="panel-heading"><div><span class="eyebrow">UPCOMING</span><h3>后续复习计划</h3></div><span class="field-meta">按到期日排列</span></div><div v-if="upcoming.length" class="review-group-list"><template v-for="([days,items]) in upcoming" :key="days"><div class="review-day-heading"><b>{{ days===1?'1 天后':`${days} 天后` }}</b><small>{{ new Date(items[0]!.nextReviewAt).toLocaleDateString() }} · {{ items.length }} 组</small></div><button v-for="row in items" :key="row.id" class="review-group-row" @click="open(row)"><span class="review-date">D+{{ days }}</span><span class="review-group-main"><b>{{ row.bankName }} · 第 {{ row.groupNumber }} 组</b><small>{{ row.sentenceIds.length }} 句 · 已复习 {{ row.reviewCount }} 次</small></span><span class="text-link">提前复习 →</span></button></template></div><p v-else class="review-empty">当前没有未来到期的组。完成初记后，这里会自动出现复习计划。</p></section>
  <section class="panel review-bucket"><div class="panel-heading"><div><span class="eyebrow">ALL GROUPS</span><h3>已初记的全部组</h3></div><span class="field-meta">{{ allGroups.length }} 组</span></div><div v-if="allGroups.length" class="review-group-list"><button v-for="row in allGroups" :key="row.id" class="review-group-row" @click="open(row)"><span class="review-date">{{ new Date(row.nextReviewAt).toLocaleDateString() }}</span><span class="review-group-main"><b>{{ row.bankName }} · 第 {{ row.groupNumber }} 组</b><small>{{ row.sentenceIds.length }} 句 · 上次复习 {{ new Date(row.lastReviewedAt).toLocaleDateString() }}</small></span><span class="text-link">打开 →</span></button></div><p v-else class="review-empty">还没有完成初记的组。完成第一组后，复习列表会自动建立。</p></section>
</template>
