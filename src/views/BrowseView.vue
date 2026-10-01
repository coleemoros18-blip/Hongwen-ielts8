<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db } from '../services/db'
import { lcsDiff, markCard, utf8Bytes } from '../services/engine'
import { isStudyMusicEnabled, startStudyMusic, stopStudyMusic } from '../services/studyMusic'
import type { Sentence, StudyGroup } from '../types'

type SearchResult = { id?: string; title?: string; url: string; displayUrl?: string; description?: string }
const route = useRoute()
const router = useRouter()
const bankId = computed(() => String(route.params.bankId))
const sentences = ref<Sentence[]>([]), index = ref(0), flipped = ref(false), masked = ref(false), clozeMode = ref(false), busy = ref(false), done = ref(0), message = ref('')
const draft = ref(''), checked = ref(false), answerStatus = ref<'correct'|'incorrect'|''>('')
const submissionError = ref(''), enterHandled = ref(false)
const completionPendingOnly = ref(false)
const onlineResults = ref<SearchResult[]>([]), searching = ref(false), searched = ref(false), searchError = ref('')
const musicError = ref('')
const current = computed(() => sentences.value[index.value])
const groupId = computed(() => String(route.query.groupId || ''))
const groupMode = computed(() => String(route.query.mode || ''))
const groupSession = ref<{ id:string; bankId:string; groupNumber:number; sentenceIds:string[]; mode:'initial'|'review'; startIndex?:number; batchSize?:number } | null>(null)
const maskedText = ref(''), clozeAnswers = ref<string[]>([])
const diff = computed(() => current.value ? lcsDiff(current.value.text, draft.value) : [])
const bytes = computed(() => utf8Bytes(draft.value))

async function load() {
  checked.value = false; answerStatus.value = ''; submissionError.value = ''
  completionPendingOnly.value = false
  const all = await db.sentences.where('bankId').equals(bankId.value).sortBy('order')
  groupSession.value = null
  if (groupId.value && groupMode.value === 'initial') {
    const [active, legacy] = await Promise.all([db.meta.get(`initialSession:${bankId.value}:${groupId.value}`),db.meta.get(`initialActiveGroup:${bankId.value}`)])
    const value = (active?.value ?? legacy?.value) as {id:string;bankId:string;groupNumber:number;sentenceIds:string[];mode:'initial';startIndex?:number;batchSize?:number} | undefined
    if (value?.id === groupId.value) groupSession.value = value
  } else if (groupId.value && groupMode.value === 'review') {
    const group = await db.studyGroups.get(groupId.value)
    if (group) groupSession.value = { id:group.id, bankId:group.bankId, groupNumber:group.groupNumber, sentenceIds:group.sentenceIds, mode:'review' }
  }
  sentences.value = groupSession.value ? groupSession.value.sentenceIds.map(id => all.find(sentence => sentence.id === id)).filter((s): s is Sentence => !!s) : all
  const cursorKey = groupSession.value ? `groupCursor:${groupSession.value.id}` : `browseCursor:${bankId.value}`
  const saved = await db.meta.get(cursorKey)
  index.value = Math.min(Number(saved?.value || 0), Math.max(0, sentences.value.length - 1))
  if (groupSession.value && sentences.value.length && index.value === sentences.value.length - 1 && current.value) {
    const lastSentence = current.value
    const completionKey = `groupAnswerRecorded:${groupSession.value.id}:${lastSentence.id}`
    const [recorded, savedAnswer, cardState] = await Promise.all([
      db.meta.get(completionKey),
      db.meta.get(`browseDraft:${bankId.value}:${lastSentence.id}`),
      db.cardStates.get(`${bankId.value}:${lastSentence.id}`),
    ])
    const answer = String(savedAnswer?.value ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase()
    const expected = lastSentence.text.trim().replace(/\s+/g,' ').toLocaleLowerCase()
    const recentLegacySuccess = groupSession.value.mode === 'initial' && cardState?.lastResult === 'known' && answer === expected && Date.now() - Date.parse(cardState.updatedAt) < 60 * 60 * 1000
    if (recorded || recentLegacySuccess) {
      completionPendingOnly.value = true
      if (!recorded && recentLegacySuccess) await db.meta.put({key:completionKey,value:true})
    }
  }
  done.value = 0; flipped.value = false; masked.value = false; clozeMode.value = false
}
async function loadDraft() {
  checked.value = false
  answerStatus.value = ''
  submissionError.value = ''
  const sentenceId = current.value?.id
  const reviewMode = groupSession.value?.mode === 'review'
  const savedDraft = sentenceId && !reviewMode ? await db.meta.get(`browseDraft:${bankId.value}:${sentenceId}`) : undefined
  if (current.value?.id !== sentenceId) return
  draft.value = reviewMode ? '' : String(savedDraft?.value ?? '')
  onlineResults.value = []; searched.value = false; searchError.value = ''
}
async function saveDraft() {
  if (!current.value) return
  await db.meta.put({ key: `browseDraft:${bankId.value}:${current.value.id}`, value: draft.value })
}
async function next() {
  if (!sentences.value.length) return
  checked.value = false; answerStatus.value = ''; submissionError.value = ''
  flipped.value = false; masked.value = false; clozeMode.value = false
  index.value = groupSession.value ? Math.min(index.value + 1, sentences.value.length - 1) : (index.value + 1) % sentences.value.length
  await db.meta.put({ key: groupSession.value ? `groupCursor:${groupSession.value.id}` : `browseCursor:${bankId.value}`, value: index.value })
}
async function previous() {
  if (!sentences.value.length) return
  checked.value = false; answerStatus.value = ''; submissionError.value = ''
  flipped.value = false; masked.value = false; clozeMode.value = false
  index.value = Math.max(0, index.value - 1)
  await db.meta.put({ key: groupSession.value ? `groupCursor:${groupSession.value.id}` : `browseCursor:${bankId.value}`, value: index.value })
}
async function mark(value: 'known' | 'fuzzy' | 'unknown') {
  if (!current.value || busy.value) return
  busy.value = true
  const finishingGroup = !!groupSession.value && index.value === sentences.value.length - 1
  const completionKey = finishingGroup && groupSession.value ? `groupAnswerRecorded:${groupSession.value.id}:${current.value.id}` : ''
  let recordedThisAttempt = false
  try {
    await saveDraft()
    const alreadyRecorded = completionKey ? await db.meta.get(completionKey) : undefined
    if (!alreadyRecorded) {
      await markCard(bankId.value, current.value.id, value)
      recordedThisAttempt = true
      if (completionKey) await db.meta.put({key:completionKey,value:true})
    }
    done.value++
    message.value = value === 'known' ? '已记录会背，安排下一次复习。' : value === 'fuzzy' ? '已记录模糊，稍后再复习。' : '已加入错句复习。'
    if (finishingGroup) { await completeGroup(); return }
    await next()
  } catch (error) {
    completionPendingOnly.value = finishingGroup && recordedThisAttempt
    throw error
  } finally { busy.value = false }
}
function handleAnswerEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return
  if (event.type === 'keydown' && enterHandled.value) { event.preventDefault(); return }
  if (event.type === 'keyup') {
    if (enterHandled.value) { enterHandled.value = false; return }
    event.preventDefault()
  } else {
    event.preventDefault()
    enterHandled.value = true
    window.setTimeout(() => { enterHandled.value = false }, 1000)
  }
  void submitAnswer()
}
async function submitAnswer() {
  if (!current.value || busy.value) return
  checked.value = true
  submissionError.value = ''
  const normalize = (value:string) => value.trim().replace(/\s+/g,' ').toLocaleLowerCase()
  const isCorrect = clozeMode.value
    ? normalize(draft.value) === normalize(clozeAnswers.value.join(' '))
    : normalize(draft.value) === normalize(current.value.text)
  if (!isCorrect) {
    answerStatus.value = 'incorrect'
    busy.value = true
    try {
      await markCard(bankId.value, current.value.id, 'unknown')
      message.value = '本次错误已记录；连续答错 3 次后会加入错句专项库。'
    } catch (error) {
      submissionError.value = error instanceof Error ? `已判定错误，但保存错答记录失败：${error.message}` : '已判定错误，但保存错答记录失败。'
    } finally {
      busy.value = false
    }
    return
  }
  answerStatus.value = 'correct'
  try { await mark('known') }
  catch (error) { submissionError.value = error instanceof Error ? `答案正确，但保存本组进度失败：${error.message}` : '答案正确，但保存进度失败。请检查后重试。' }
}
function addDays(date: Date, days: number) { return new Date(date.getTime() + days * 86400000).toISOString() }
async function completeGroup() {
  if (!groupSession.value) return
  const session = groupSession.value, now = new Date(), cursorKey = `groupCursor:${session.id}`
  const sentenceIds = Array.from(session.sentenceIds)
  const completionKey = `groupAnswerRecorded:${session.id}:${sentenceIds[sentenceIds.length - 1]}`
  if (session.mode === 'initial') {
    const group: StudyGroup = { id:session.id, bankId:session.bankId, groupNumber:session.groupNumber, sentenceIds, completedAt:now.toISOString(), lastReviewedAt:now.toISOString(), reviewCount:0, nextReviewAt:addDays(now,1) }
    await db.transaction('rw', db.studyGroups, db.meta, db.sentences, async () => {
      await db.studyGroups.put(group)
      const key = `initialPlan:${session.bankId}`, saved = await db.meta.get(key)
      const plan = (saved?.value as {nextIndex:number;nextGroupNumber:number;batchSize:number} | undefined) ?? {nextIndex:0,nextGroupNumber:1,batchSize:10}
      const isNextSequentialGroup = session.startIndex === undefined ? session.groupNumber === plan.nextGroupNumber : session.startIndex === plan.nextIndex
      const nextIndex = isNextSequentialGroup ? Math.min(await db.sentences.where('bankId').equals(session.bankId).count(),plan.nextIndex+session.sentenceIds.length) : plan.nextIndex
      const batchSize = session.batchSize ?? plan.batchSize
      await db.meta.put({key,value:{...plan,nextIndex,nextGroupNumber:Math.floor(nextIndex/batchSize)+1,batchSize}})
      await db.meta.delete(`initialSession:${session.bankId}:${session.id}`)
      const legacy = await db.meta.get(`initialActiveGroup:${session.bankId}`)
      if ((legacy?.value as {id?:string}|undefined)?.id === session.id) await db.meta.delete(`initialActiveGroup:${session.bankId}`)
      await db.meta.delete(cursorKey); await db.meta.delete(completionKey)
    })
    message.value = `第 ${session.groupNumber} 组已完成，已加入明天的强化复习。`
    await router.push({ path:'/initial', query:{ completedGroup:String(session.groupNumber), reviewGroupId:session.id } })
  } else {
    const group = await db.studyGroups.get(session.id)
    if (group) {
      const reviewCount = group.reviewCount + 1, intervals = [1,2,4,7,15,30]
      const nextReviewAt = addDays(now, intervals[Math.min(reviewCount, intervals.length - 1)]!)
      await db.studyGroups.update(group.id,{reviewCount,lastReviewedAt:now.toISOString(),nextReviewAt})
    }
    await db.meta.delete(cursorKey); await db.meta.delete(completionKey)
    const nextReviewAt = (await db.studyGroups.get(session.id))?.nextReviewAt ?? addDays(now,1)
    message.value = `第 ${session.groupNumber} 组复习完成，下一次间隔已重新安排。`
    await router.push({ path:'/review', query:{ completedGroup:String(session.groupNumber), nextReviewAt } })
  }
}
async function retryGroupCompletion() {
  if (!completionPendingOnly.value || busy.value) return
  busy.value = true
  submissionError.value = ''
  try { await completeGroup(); completionPendingOnly.value = false }
  catch (error) { submissionError.value = error instanceof Error ? `本组进度仍未保存：${error.message}` : '本组进度仍未保存，请重试。' }
  finally { busy.value = false }
}
function flip() { if (!busy.value) { flipped.value = !flipped.value; masked.value = false } }
function toggleCloze() {
  if (!current.value) return
  checked.value = false
  answerStatus.value = ''
  clozeMode.value = !clozeMode.value
  if (clozeMode.value) {
    // Generate a fresh random deletion preview whenever the learner enters cloze mode.
    const words = [...current.value.text.matchAll(/[A-Za-z][A-Za-z'-]*/g)]
    const hidden = new Set(words.map((_, i) => i).filter(() => Math.random() < 0.38))
    if (words.length && !hidden.size) hidden.add(Math.floor(Math.random() * words.length))
    clozeAnswers.value = [...hidden].sort((a,b)=>a-b).map(i=>words[i]![0])
    let wordIndex = 0
    maskedText.value = current.value.text.replace(/[A-Za-z][A-Za-z'-]*/g, word => hidden.has(wordIndex++) ? '＿'.repeat([...word].length) : word)
    flipped.value = true
    draft.value = ''
  } else {
    maskedText.value = ''
    flipped.value = false
  }
}
function keyMark(e: Event) { const n = (e as CustomEvent<number>).detail; if (n === 1) void mark('known'); if (n === 2) void mark('fuzzy'); if (n === 3) void mark('unknown') }
async function searchExamples() {
  if (!current.value || searching.value) return
  searching.value = true; searched.value = true; searchError.value = ''; onlineResults.value = []
  try {
    // Only sent after the user presses this button. The exact sentence helps find genuinely similar examples.
    const query = `IELTS sample question "${current.value.text}"`
    const params = new URLSearchParams({ q: query, page: '1' })
    const response = await fetch(`https://puri.li/api/search?${params}`)
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`)
    const payload = await response.json() as { results?: SearchResult[] }
    onlineResults.value = (payload.results ?? []).slice(0, 5)
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : '联网检索失败，请检查网络后重试。'
  } finally { searching.value = false }
}
onMounted(() => { void load(); window.addEventListener('memory:flip', flip); window.addEventListener('memory:mark', keyMark) })
onUnmounted(() => { window.removeEventListener('memory:flip', flip); window.removeEventListener('memory:mark', keyMark); stopStudyMusic() })
watch(() => [bankId.value, groupId.value, groupMode.value], () => { void load() })
watch(index, value => { if (sentences.value.length) void db.meta.put({ key: groupSession.value ? `groupCursor:${groupSession.value.id}` : `browseCursor:${bankId.value}`, value }) })
watch(current, () => { void loadDraft() }, { immediate: true })
watch(draft, () => { void saveDraft() })
watch(groupSession, async value => {
  const musicEnabled = isStudyMusicEnabled()
  if (value && musicEnabled) { const ok = await startStudyMusic(); musicError.value = ok ? '' : '可在设置中开启背景音乐；部分浏览器需先进行一次点击。' }
  else { stopStudyMusic(); musicError.value = '' }
})
</script>

<template>
  <Teleport v-if="groupSession" to="#topbar-study-center">
    <div class="group-study-summary"><span class="eyebrow">{{ groupSession.mode === 'initial' ? 'FIRST PASS GROUP' : 'SPACED REVIEW GROUP' }}</span><h2>{{ groupSession.mode === 'initial' ? '初记' : '强化复习' }} · 第 {{ groupSession.groupNumber }} 组</h2><p>先读中文释义，尝试写出英文原句。</p><div class="group-study-progress"><span>本组进度</span><b>{{ sentences.length ? index + 1 : 0 }} / {{ sentences.length }}</b><span>句</span></div></div>
  </Teleport>
  <section v-if="!groupSession" class="study-head"><div><span class="eyebrow">BROWSE & REMEMBER</span><h2>浏览背诵</h2><p>先读中文释义，尝试写出英文原句。今天已完成 {{ done }} 句。</p></div><div class="study-counter"><b>{{ sentences.length ? index + 1 : 0 }}</b><span>/ {{ sentences.length }}</span></div></section>
  <div v-if="current" class="browse-layout" :class="{'group-study-layout':!!groupSession}">
    <div>
      <article class="flash-card browse-card" :class="{'is-flipped':flipped}">
        <div class="flash-top"><span class="pill pill-learning">{{ clozeMode ? '英文挖空填空' : flipped ? '英文原句' : '根据中文回忆英文' }}</span><button class="soft-button" @click="toggleCloze">{{ clozeMode ? '退出挖空' : '英文挖空预览' }}</button></div>
        <div class="flash-main"><Transition name="fade" mode="out-in"><div :key="flipped?'back':'front'" class="flash-content">
          <template v-if="!flipped">
            <p class="browse-prompt">中文释义</p>
            <p class="sentence-meaning browse-meaning">{{ current.meaning || '这句话还没有中文释义。可先翻开英文原句，再到句库中心补充释义。' }}</p>
            <label class="answer-label" for="recall-answer">写出英文原句</label>
            <div class="recall-row"><small class="recall-error">{{ answerStatus==='incorrect' ? '错误' : '' }}</small><textarea id="recall-answer" v-model="draft" class="recall-input" :maxlength="300" rows="4" placeholder="输入英文原句，按 Enter 提交；Shift+Enter 换行" @keydown.enter="handleAnswerEnter" @keyup.enter="handleAnswerEnter"></textarea></div>
            <div class="recall-meta"><span :class="{'over-limit':bytes>300}">{{ bytes }} / 300 字节（UTF-8）</span><span>自动保存</span></div>
            <div v-if="checked && !clozeMode" class="answer-check"><p class="diff-line"><span v-for="(part,i) in diff" :key="i" :class="`diff-${part.kind}`">{{ part.char }}</span></p><small class="diff-legend">绿色为一致 · 红色为漏写 · 橙色为多写；忽略大小写和多余空格</small></div><p v-if="submissionError" class="error-inline">{{ submissionError }}</p><button v-if="completionPendingOnly" class="button button-outline" :disabled="busy" @click="retryGroupCompletion">重试保存本组</button>
          </template>
          <template v-else>
            <p class="browse-prompt revealed-meaning-label">{{ clozeMode ? '根据英文原句回忆缺失内容' : '中文释义' }}</p>
            <p v-if="current.meaning && !clozeMode" class="sentence-meaning revealed-meaning">{{ current.meaning }}</p>
            <p class="sentence-text answer-english">{{ clozeMode ? maskedText : current.text }}</p>
            <div v-if="clozeMode" class="cloze-area"><label class="answer-label" for="cloze-answer">按顺序填入挖空单词</label><textarea id="cloze-answer" v-model="draft" class="recall-input cloze-input" rows="2" placeholder="按顺序输入缺失的英文单词，用空格分开；按 Enter 核对" @keydown.enter="handleAnswerEnter" @keyup.enter="handleAnswerEnter"></textarea><p v-if="checked" class="cloze-feedback" :class="answerStatus==='correct'?'is-correct':'is-incorrect'">{{ answerStatus==='correct' ? '正确' : '错误，请修改后再按 Enter' }}</p><p v-if="submissionError" class="error-inline">{{ submissionError }}</p></div>
          </template>
        </div></Transition></div>
        <div class="flash-bottom"><button class="arrow-button" :disabled="index===0" @click="previous">← 上一句</button><span>{{ index + 1 }} / {{ sentences.length }}</span><button class="arrow-button" :disabled="!!groupSession && index===sentences.length-1" @click="next">下一句 →</button></div>
      </article>
      <div class="mark-row"><button class="mark-button known" @click="mark('known')"><b>✓</b><span>会背</span><kbd>1</kbd></button><button class="mark-button fuzzy" @click="mark('fuzzy')"><b>~</b><span>模糊</span><kbd>2</kbd></button><button class="mark-button unknown" @click="mark('unknown')"><b>↺</b><span>不会</span><kbd>3</kbd></button></div>
      <p v-if="musicError" class="music-error">{{ musicError }}</p>
      <p v-if="groupSession" class="music-credit">背景音乐：Mozart, Piano Sonata No. 11 in A major, K.331, I. Andante grazioso · <a href="https://commons.wikimedia.org/wiki/File:Mozart_-_Piano_Sonata_No._11_in_A_major_-_I._Andante_grazioso.ogg" target="_blank" rel="noopener noreferrer">Bernd Krueger 录音来源</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/de/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0 DE</a></p>
    </div>
    <aside class="examples-panel panel">
      <span class="eyebrow">EXAMPLE FINDER</span><h3>相似例句</h3>
      <p>搜索公开网页中与本句相关的 IELTS 示例或练习材料。结果仅供参考，不代表雅思官方真题原文。</p>
      <p class="privacy-note">点击检索后，会将当前英文句子发送到 Purili 公共搜索服务。不开启检索时不会发送。</p>
      <button class="primary-button example-search" :disabled="searching" @click="searchExamples">{{ searching ? '正在搜索…' : '在线搜索相似例句' }}</button>
      <p v-if="searchError" class="search-error">{{ searchError }} <button class="text-link" @click="searchExamples">重试</button></p>
      <p v-else-if="searched && !searching && !onlineResults.length" class="example-empty">暂时没有找到结果，可调整原句或稍后再试。</p>
      <ul v-if="onlineResults.length" class="example-results"><li v-for="result in onlineResults" :key="result.id || result.url"><a :href="result.url" target="_blank" rel="noopener noreferrer">{{ result.title || result.displayUrl || result.url }} ↗</a><p>{{ result.description || '打开来源查看相关内容。' }}</p><small>{{ result.displayUrl || result.url }}</small></li></ul>
      <a class="provider-link" href="https://puri.li/developer/documentation" target="_blank" rel="noopener noreferrer">搜索服务与 API 说明 ↗</a>
    </aside>
  </div>
  <div v-else class="empty-state panel"><span>✳</span><b>这个句库还没有句子</b><p>去句库中心添加或批量导入几句吧。</p><RouterLink to="/banks" class="text-link">打开句库中心 →</RouterLink></div>
  <p v-if="message" class="toast-inline">{{ message }}</p>
</template>
