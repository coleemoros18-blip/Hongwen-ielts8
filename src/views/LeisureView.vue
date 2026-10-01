<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { db } from '../services/db'
import { useAppStore } from '../stores/app'
import type { Bank, Sentence } from '../types'

type Direction = 'english-first' | 'chinese-first'
type PlaybackPhase = 'revealing' | 'advancing'
type Preferences = { bankId:string; groupSize:number; groupNumber:number; direction:Direction; delaySeconds:number }
const store = useAppStore()
const banks = ref<Bank[]>([]), selectedBank = ref(store.bankId), allSentences = ref<Sentence[]>([])
const groupSize = ref(10), groupNumber = ref(1), direction = ref<Direction>('english-first'), delaySeconds = ref(5)
const studying = ref(false), finished = ref(false), groupSentences = ref<Sentence[]>([]), currentIndex = ref(0), revealed = ref(false), secondsRemaining = ref(5), playbackPhase = ref<PlaybackPhase>('revealing')
let revealTimer:number | undefined
const groupCount = computed(() => Math.max(1,Math.ceil(allSentences.value.length/Math.max(1,groupSize.value))))
const current = computed(() => groupSentences.value[currentIndex.value])
const showingEnglishFirst = computed(() => direction.value === 'english-first')
const primaryText = computed(() => !current.value ? '' : showingEnglishFirst.value ? current.value.text : current.value.meaning || '这句话还没有中文翻译。')
const secondaryText = computed(() => !current.value ? '' : showingEnglishFirst.value ? current.value.meaning : current.value.text)
const waitLabel = computed(() => playbackPhase.value === 'revealing'
  ? `另一种语言将在 ${secondsRemaining.value} 秒后渐显`
  : currentIndex.value === groupSentences.value.length - 1
    ? `本组将在 ${secondsRemaining.value} 秒后结束`
    : `下一句将在 ${secondsRemaining.value} 秒后自动显示`)
const preferenceKey = 'leisureMemoryPreferences'
function stopTimer(){if(revealTimer!==undefined){window.clearInterval(revealTimer);revealTimer=undefined}}
function loadPreferences(){try{const p=JSON.parse(localStorage.getItem(preferenceKey)||'{}') as Partial<Preferences>;if(p.bankId)selectedBank.value=p.bankId;if(p.groupSize)groupSize.value=Math.min(100,Math.max(1,Number(p.groupSize)||10));if(p.groupNumber)groupNumber.value=Math.max(1,Number(p.groupNumber)||1);if(p.direction==='english-first'||p.direction==='chinese-first')direction.value=p.direction;if(p.delaySeconds)delaySeconds.value=Math.min(30,Math.max(1,Number(p.delaySeconds)||5))}catch{ /* Ignore invalid local preferences. */ }}
async function loadBank(){allSentences.value=selectedBank.value?await db.sentences.where('bankId').equals(selectedBank.value).sortBy('order'):[];groupNumber.value=Math.min(Math.max(1,groupNumber.value),groupCount.value)}
function savePreferences(){localStorage.setItem(preferenceKey,JSON.stringify({bankId:selectedBank.value,groupSize:groupSize.value,groupNumber:groupNumber.value,direction:direction.value,delaySeconds:delaySeconds.value} satisfies Preferences))}
function beginTimer(){stopTimer();revealed.value=false;playbackPhase.value='revealing';secondsRemaining.value=delaySeconds.value;revealTimer=window.setInterval(()=>{if(secondsRemaining.value>1){secondsRemaining.value--;return}secondsRemaining.value=0;if(playbackPhase.value==='revealing'){revealed.value=true;playbackPhase.value='advancing';secondsRemaining.value=delaySeconds.value;return}if(currentIndex.value>=groupSentences.value.length-1){finished.value=true;stopTimer();return}currentIndex.value++;revealed.value=false;playbackPhase.value='revealing';secondsRemaining.value=delaySeconds.value},1000)}
function revealNow(){if(revealed.value)return;revealed.value=true;playbackPhase.value='advancing';secondsRemaining.value=delaySeconds.value}
function start(){if(!allSentences.value.length)return;const startAt=(groupNumber.value-1)*groupSize.value;groupSentences.value=allSentences.value.slice(startAt,startAt+groupSize.value);if(!groupSentences.value.length)return;currentIndex.value=0;finished.value=false;studying.value=true;store.setBank(selectedBank.value);beginTimer()}
function previous(){if(currentIndex.value<=0)return;stopTimer();currentIndex.value--;beginTimer()}
function backToSetup(){stopTimer();studying.value=false;finished.value=false}
watch(selectedBank,()=>{void loadBank();savePreferences()})
watch([groupSize,groupNumber,direction,delaySeconds],savePreferences)
watch(groupSize, value=>{groupSize.value=Math.min(100,Math.max(1,Math.floor(Number(value)||10)));groupNumber.value=Math.min(groupNumber.value,groupCount.value)})
onMounted(()=>{loadPreferences();void loadBank();void db.banks.toArray().then(value=>{banks.value=value;if(!banks.value.some(bank=>bank.id===selectedBank.value)&&banks.value[0])selectedBank.value=banks.value[0]!.id})})
onUnmounted(stopTimer)
</script>

<template>
  <template v-if="!studying">
    <section class="section-heading"><div><span class="eyebrow">LEISURE MEMORY</span><h2>休闲记忆</h2><p>选择一组句子，按自己的节奏先看一种语言，再延迟显示另一种语言。</p></div></section>
    <section class="panel leisure-setup">
      <label class="field-label">选择句库<select v-model="selectedBank"><option v-for="bank in banks" :key="bank.id" :value="bank.id">{{ bank.name }}</option></select></label>
      <div class="leisure-config-grid"><label class="field-label">每组句数<input v-model.number="groupSize" type="number" min="1" max="100"></label><label class="field-label">选择组号<select v-model.number="groupNumber"><option v-for="n in groupCount" :key="n" :value="n">第 {{ n }} 组 · {{ Math.min(groupSize,Math.max(0,allSentences.length-(n-1)*groupSize)) }} 句</option></select></label><label class="field-label">答案延迟 <b class="leisure-delay-value">{{ delaySeconds }} 秒</b><input v-model.number="delaySeconds" type="range" min="1" max="30"></label></div>
      <div class="leisure-direction"><span class="answer-label">先显示哪种语言？</span><label :class="{'selected':direction==='english-first'}"><input v-model="direction" type="radio" value="english-first"><span><b>先英文，后中文</b><small>英文原文先显示，翻译延迟出现</small></span></label><label :class="{'selected':direction==='chinese-first'}"><input v-model="direction" type="radio" value="chinese-first"><span><b>先中文，后英文</b><small>中文翻译先显示，原文延迟出现</small></span></label></div>
      <div class="leisure-setup-footer"><span>{{ allSentences.length }} 句 · 共 {{ allSentences.length?groupCount:0 }} 组 · 这些练习不会更改初记进度</span><button class="button button-dark" :disabled="!allSentences.length" @click="start">开始休闲记忆 →</button></div>
      <p v-if="!allSentences.length" class="review-empty">当前句库还没有句子，请先去句库中心导入内容。</p>
    </section>
  </template>

  <section v-else class="leisure-study-mode">
    <header v-if="!finished" class="leisure-study-header"><div><span class="eyebrow">LEISURE MEMORY · 第 {{ groupNumber }} 组</span><h2>{{ banks.find(bank=>bank.id===selectedBank)?.name }}</h2><p>{{ currentIndex+1 }} / {{ groupSentences.length }} 句 · {{ showingEnglishFirst?'先英文，后中文':'先中文，后英文' }}</p></div><button class="button button-outline" @click="backToSetup">退出本组</button></header>
    <article v-if="current && !finished" class="leisure-card">
      <div class="leisure-card-top"><span class="pill pill-learning">{{ showingEnglishFirst?'英文原文':'中文翻译' }}</span><span class="leisure-wait" :class="{'is-revealed':revealed}">{{ waitLabel }}</span></div>
      <div class="leisure-copy"><p class="leisure-primary" :class="{'is-chinese':!showingEnglishFirst}">{{ primaryText }}</p><Transition name="leisure-reveal"><div v-if="revealed" class="leisure-secondary-wrap"><span class="leisure-divider"></span><p class="leisure-secondary" :class="{'is-english':!showingEnglishFirst}">{{ secondaryText || (showingEnglishFirst?'暂无中文翻译':'') }}</p></div></Transition><button v-if="!revealed" class="leisure-reveal" @click="revealNow">现在显示{{ showingEnglishFirst?'中文翻译':'英文原文' }} ↗</button></div>
      <footer class="leisure-card-bottom"><span>{{ current.source || '我的句子' }}</span><div><button class="button button-outline" :disabled="currentIndex===0" @click="previous">← 上一句</button><span class="leisure-autoplay-note">自动播放中</span></div></footer>
    </article>
    <section v-else class="leisure-card leisure-complete"><span class="eyebrow">GROUP COMPLETE</span><h2>本组已经结束</h2><p>已完成第 {{ groupNumber }} 组 · {{ groupSentences.length }} 句。</p><button class="button button-dark" @click="backToSetup">选择其他组 →</button></section>
  </section>
</template>
