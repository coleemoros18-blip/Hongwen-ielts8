<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db } from '../services/db'
import { startStudyMusic } from '../services/studyMusic'
import { useAppStore } from '../stores/app'
import type { Bank, Sentence } from '../types'

type Plan = { nextIndex: number; nextGroupNumber: number; batchSize: number }
type ActiveGroup = { id: string; bankId: string; groupNumber: number; sentenceIds: string[]; mode: 'initial'; startIndex?: number; batchSize?: number }
const store = useAppStore(), router = useRouter(), route = useRoute()
const banks = ref<Bank[]>([]), allSentences = ref<Sentence[]>([]), bankId = ref(store.bankId), plan = ref<Plan>({ nextIndex: 0, nextGroupNumber: 1, batchSize: 10 }), selectedGroupNumber = ref(1), activeSessions = ref<ActiveGroup[]>([]), total = ref(0), loading = ref(true), startBusy = ref(false), startError = ref('')
const completedGroup = ref<{id:string;groupNumber:number}|null>(null)
const remaining = computed(() => Math.max(0, total.value - plan.value.nextIndex))
const safeBatchSize = computed(() => Math.min(100, Math.max(1, Math.floor(Number(plan.value.batchSize) || 10))))
const groupCount = computed(() => Math.ceil(total.value / safeBatchSize.value))
const suggestedGroupNumber = computed(() => groupCount.value ? Math.min(groupCount.value, Math.floor(plan.value.nextIndex / safeBatchSize.value) + 1) : 1)
const selectedGroupSentences = computed(() => allSentences.value.slice((selectedGroupNumber.value - 1) * safeBatchSize.value, selectedGroupNumber.value * safeBatchSize.value))
const selectedGroupStarted = computed(() => (selectedGroupNumber.value - 1) * safeBatchSize.value < plan.value.nextIndex)
const selectedActiveSession = computed(() => {
  const expectedIds = selectedGroupSentences.value.map(sentence=>sentence.id)
  return activeSessions.value.find(session => session.id === `initial-${bankId.value}-${safeBatchSize.value}-${(selectedGroupNumber.value-1)*safeBatchSize.value}` || (session.startIndex === undefined && session.sentenceIds.length === expectedIds.length && session.sentenceIds.every((id,index)=>id===expectedIds[index])))
})
async function load() {
  loading.value = true; startError.value = ''
  try {
    banks.value = await db.banks.orderBy('updatedAt').reverse().toArray()
    if (!banks.value.some(bank => bank.id === bankId.value)) bankId.value = banks.value[0]?.id ?? ''
    if (!bankId.value) { total.value = 0; activeSessions.value = []; return }
    const [storedPlan, storedActive, storedSessions, sentences] = await Promise.all([
      db.meta.get(`initialPlan:${bankId.value}`), db.meta.get(`initialActiveGroup:${bankId.value}`), db.meta.toArray(), db.sentences.where('bankId').equals(bankId.value).sortBy('order'),
    ])
    const saved = storedPlan?.value as Partial<Plan> | undefined
    plan.value = { nextIndex:Math.max(0,Number(saved?.nextIndex)||0), nextGroupNumber:Math.max(1,Number(saved?.nextGroupNumber)||1), batchSize:Math.min(100,Math.max(1,Math.floor(Number(saved?.batchSize)||10))) }
    const sessionPrefix = `initialSession:${bankId.value}:`
    const sessions = storedSessions.filter(row=>row.key.startsWith(sessionPrefix)).map(row=>({key:row.key,session:row.value as ActiveGroup}))
    const legacy = storedActive?.value as ActiveGroup | undefined
    const candidates = [...sessions.map(row=>row.session),...(legacy ? [legacy] : [])]
    activeSessions.value = [...new Map(candidates.filter(session=>session?.id&&session.sentenceIds?.length&&session.sentenceIds.some(id=>sentences.some(sentence=>sentence.id===id))).map(session=>[session.id,session])).values()]
    const validIds = new Set(activeSessions.value.map(session=>session.id))
    for (const row of sessions) if (!validIds.has(row.session?.id)) await db.meta.delete(row.key)
    if (legacy && !validIds.has(legacy.id)) await db.meta.delete(`initialActiveGroup:${bankId.value}`)
    allSentences.value = sentences
    total.value = sentences.length
    selectedGroupNumber.value = sentences.length ? Math.min(Math.ceil(sentences.length / plan.value.batchSize), Math.floor(plan.value.nextIndex / plan.value.batchSize) + 1) : 1
    const completedId = String(route.query.reviewGroupId ?? '')
    const completedNumber = Number(route.query.completedGroup)
    const completedRecord = completedId ? await db.studyGroups.get(completedId) : undefined
    completedGroup.value = completedRecord?.bankId === bankId.value && completedNumber === completedRecord.groupNumber
      ? {id:completedRecord.id,groupNumber:completedRecord.groupNumber}
      : null
  } finally { loading.value = false }
}
async function startSelectedGroup(groupNumber = selectedGroupNumber.value) {
  startError.value = ''
  if (startBusy.value) return
  void startStudyMusic()
  startBusy.value = true
  try {
    if (!bankId.value) throw new Error('请先创建或选择一个句库。')
    const sentences: Sentence[] = await db.sentences.where('bankId').equals(bankId.value).sortBy('order')
    allSentences.value = sentences; total.value = sentences.length
    const batchSize = safeBatchSize.value
    const startIndex = Math.max(0, (Math.floor(groupNumber) - 1) * batchSize)
    const selected = sentences.slice(startIndex, startIndex + batchSize)
    if (!selected.length) throw new Error(sentences.length ? '没有找到所选组，请检查组号和每组句数。' : '所选句库还没有句子，请先到“句库中心”导入句子。')
    const sessionId = `initial-${bankId.value}-${batchSize}-${startIndex}`
    const existingSession = activeSessions.value.find(session=>session.id===sessionId || (session.startIndex===undefined&&session.sentenceIds.length===selected.length&&session.sentenceIds.every((id,index)=>id===selected[index]?.id)))
    if (existingSession) return await resume(existingSession)
    const session: ActiveGroup = { id: sessionId, bankId: bankId.value, groupNumber:Math.floor(groupNumber), startIndex, batchSize, sentenceIds: selected.map(sentence => sentence.id), mode: 'initial' }
    await db.meta.delete(`groupCursor:${session.id}`)
    await db.meta.delete(`groupAnswerRecorded:${session.id}:${session.sentenceIds[session.sentenceIds.length - 1]}`)
    await db.meta.put({ key: `initialSession:${bankId.value}:${session.id}`, value: session })
    await db.meta.put({ key: `initialPlan:${bankId.value}`, value: {...plan.value,batchSize} })
    activeSessions.value = [...activeSessions.value,session]; plan.value = {...plan.value,batchSize}
    store.setBank(bankId.value)
    selectedGroupNumber.value = session.groupNumber
    await router.push(`/banks/${bankId.value}/browse?groupId=${encodeURIComponent(session.id)}&mode=initial`)
  } catch (error) { startError.value = error instanceof Error ? error.message : '无法开始本组，请重试。' }
  finally { startBusy.value = false }
}
async function continueNextGroup() { selectedGroupNumber.value = suggestedGroupNumber.value; await startSelectedGroup(suggestedGroupNumber.value) }
async function resume(session:ActiveGroup) { void startStudyMusic(); await router.push(`/banks/${session.bankId}/browse?groupId=${encodeURIComponent(session.id)}&mode=initial`) }
async function reviewCompletedGroup() {
  if (!completedGroup.value) return
  const group = await db.studyGroups.get(completedGroup.value.id)
  if (!group || group.bankId !== bankId.value) { startError.value = '找不到刚完成的组，请从强化复习列表选择。'; return }
  void startStudyMusic()
  await router.push(`/banks/${group.bankId}/browse?groupId=${encodeURIComponent(group.id)}&mode=review`)
}
watch(bankId, () => void load())
watch(() => [route.query.completedGroup,route.query.reviewGroupId], () => void load())
watch([safeBatchSize, total], () => { selectedGroupNumber.value = groupCount.value ? Math.min(Math.max(1, selectedGroupNumber.value), groupCount.value) : 1 })
watch(plan, value => { if (bankId.value) void db.meta.put({ key:`initialPlan:${bankId.value}`, value:{...value, batchSize:Math.min(100,Math.max(1,Math.floor(value.batchSize||10)))} }) }, {deep:true})
onMounted(() => void load())
</script>

<template>
  <section class="section-heading"><div><span class="eyebrow">FIRST PASS</span><h2>初记</h2><p>按句库分组学习。完成一组后会自动记住下一组的位置。</p></div></section>
  <section class="panel initial-panel" :aria-busy="loading">
    <label class="field-label">选择一本书 / 句库<select v-model="bankId"><option v-for="bank in banks" :key="bank.id" :value="bank.id">{{ bank.name }}</option></select></label>
    <div v-if="completedGroup" class="group-completion-notice"><div><b>已经完成第 {{ completedGroup.groupNumber }} 组</b><p>本组已记录，并已安排强化复习。你可以从下方任意选择一组重新背诵。</p></div><button class="button button-outline" @click="reviewCompletedGroup">直接强化复习第 {{ completedGroup.groupNumber }} 组</button></div>
    <div class="initial-overview"><div><small>句库总数</small><b>{{ total }} 句</b></div><div><small>已完成初记</small><b>{{ plan.nextIndex }} 句 · 第 {{ Math.ceil(plan.nextIndex / safeBatchSize) }} 组</b></div><div><small>尚未初记</small><b>{{ remaining }} 句</b></div></div>
    <div v-if="activeSessions.length" class="active-session-list"><div v-for="session in activeSessions" :key="session.id" class="resume-notice"><div><b>有一组尚未完成</b><p>第 {{ session.groupNumber }} 组 · {{ session.sentenceIds.length }} 句。继续后会从上次停下的位置开始。</p></div><button class="button button-outline" @click="resume(session)">继续第 {{ session.groupNumber }} 组 →</button></div></div>
    <div class="initial-group-controls">
      <label class="field-label group-size-label">每组句数<input v-model.number="plan.batchSize" type="number" min="1" max="100" step="1" @change="plan.batchSize=Math.min(100,Math.max(1,Math.floor(plan.batchSize||10)))"></label>
      <label class="field-label group-picker-label">选择组号<select v-model.number="selectedGroupNumber" :disabled="!groupCount"><option v-for="number in groupCount" :key="number" :value="number">第 {{ number }} 组 · 第 {{ (number-1)*safeBatchSize+1 }}–{{ Math.min(number*safeBatchSize,total) }} 句</option></select></label>
    </div>
    <p class="field-help">当前共 {{ groupCount }} 组，可选择任意组重新背诵；更改每组句数后，组号和句子范围会自动调整。默认选中尚未完成的下一组。</p>
    <div class="initial-actions"><button class="button button-dark" :disabled="loading||startBusy||!selectedGroupSentences.length" @click="startSelectedGroup()">{{ startBusy?'正在打开…':`${selectedActiveSession?'继续':selectedGroupStarted?'重新背':'开始'}第 ${selectedGroupNumber} 组 · ${selectedGroupSentences.length} 句` }} →</button><button v-if="suggestedGroupNumber!==selectedGroupNumber&&remaining" class="button button-outline" :disabled="loading||startBusy" @click="continueNextGroup">继续下一组 · 第 {{ suggestedGroupNumber }} 组</button><span>本书进度自动保存</span></div>
    <p v-if="startError" class="error-inline initial-error">{{ startError }}</p>
  </section>
  <section class="panel group-guide"><span class="eyebrow">HOW IT WORKS</span><h3>每组学习完成后进入复习计划</h3><p>初记中的组会单独记录。完成后第 1 天安排第一次复习，复习后依次间隔 2、4、7、15、30 天；你可以在“强化复习”中查看并提前打开任意组。</p></section>
</template>
