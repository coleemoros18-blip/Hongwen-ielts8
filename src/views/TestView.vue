<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { db } from '../services/db'
import { dailyQueue, lcsDiff, logTest, markCard } from '../services/engine'
import type { Sentence } from '../types'

type Mode = 'cloze' | 'reorder' | 'dictation' | 'context'
const route = useRoute()
const bankId = computed(() => String(route.params.bankId))
const mode = ref<Mode>('cloze')
const sentences = ref<Sentence[]>([])
const queue = ref<Sentence[]>([])
const position = ref(0)
const input = ref('')
const selected = ref(-1)
const choice = ref(-1)
const clozeOptions = ref<string[]>([])
const submitted = ref(false)
const answers = ref<Array<{ sentenceId: string; prompt: string; answer: string; correct: boolean }>>([])
const started = ref('')
const report = ref(false)
const hint = ref(false)
const chunks = ref<string[]>([])
const current = computed(() => queue.value[position.value])
const modes: Array<[Mode, string]> = [['cloze','挖空填空'],['reorder','句段重组'],['dictation','整句默写'],['context','上下句选择']]
const progress = computed(() => queue.value.length ? Math.round(position.value / queue.value.length * 100) : 0)
const contextOptions = computed(() => {
  if (!current.value) return []
  const index = sentences.value.findIndex(s => s.id === current.value!.id)
  const next = sentences.value[index + 1]?.text
  const other = sentences.value.filter(s => s.id !== current.value!.id && s.text !== next).slice(0, 3).map(s => s.text)
  return (next ? [next, ...other] : other).sort((a, b) => a.localeCompare(b))
})
function normalize(value: string) { return value.trim().replace(/[\s.,!?;:'"“”‘’()[\]{}-]/g, '').toLocaleLowerCase() }
function clozeTarget(text: string) { return text.match(/[A-Za-z][A-Za-z'-]*/g)?.sort((a,b) => b.length-a.length)[0] || [...text].filter(c => /[\p{L}\p{N}]/u.test(c)).slice(0,2).join('') }
function splitChunks(text: string) { const words=text.split(/\s+/), size=Math.max(2,Math.ceil(words.length/4)), chunks:string[]=[]; for(let i=0;i<words.length;i+=size) chunks.push(words.slice(i,i+size).join(' ')); return chunks.sort(()=>Math.random()-.5) }
function setChoices() {
  if (!current.value) return
  const answer = clozeTarget(current.value.text)
  const words = sentences.value.flatMap(s => s.text.match(/[A-Za-z][A-Za-z'-]*/g) || []).filter(w => normalize(w) !== normalize(answer))
  const distractors = [...new Set([...words, 'however', 'therefore', 'although', 'important'])].sort(() => Math.random()-.5).slice(0,3)
  clozeOptions.value = [answer, ...distractors].sort(() => Math.random()-.5)
}
async function start() {
  sentences.value = await db.sentences.where('bankId').equals(bankId.value).sortBy('order')
  const scheduled = await dailyQueue(bankId.value)
  const valid = scheduled.map(x => x.sentence).filter(s => sentences.value.some(row => row.id === s.id))
  queue.value = mode.value === 'context'
    ? valid.filter(s => sentences.value.findIndex(row => row.id === s.id) < sentences.value.length - 1).slice(0,10)
    : valid.slice(0,10)
  if (!queue.value.length && mode.value !== 'context') queue.value = sentences.value.slice(0,5)
  if (!queue.value.length && mode.value === 'context' && sentences.value.length > 1) queue.value = sentences.value.slice(0, Math.min(5, sentences.value.length-1))
  position.value=0; answers.value=[]; report.value=false; submitted.value=false; started.value=new Date().toISOString(); input.value=''; choice.value=-1; hint.value=false
  if (current.value) { chunks.value=splitChunks(current.value.text); setChoices() }
}
async function check() {
  if (submitted.value || !current.value) return
  let answer=input.value, correct=false
  if (mode.value==='cloze') { answer=clozeOptions.value[choice.value] || ''; correct=normalize(answer)===normalize(clozeTarget(current.value.text)) }
  else if (mode.value==='reorder') { answer=chunks.value.join(' '); correct=normalize(answer)===normalize(current.value.text) }
  else if (mode.value==='dictation') correct=normalize(answer)===normalize(current.value.text)
  else { answer=choice.value>=0?contextOptions.value[choice.value]:''; const i=sentences.value.findIndex(s=>s.id===current.value!.id); correct=answer===sentences.value[i+1]?.text }
  selected.value=correct?1:0; submitted.value=true
  answers.value.push({sentenceId:current.value.id,prompt:current.value.text,answer,correct})
  await markCard(bankId.value,current.value.id,correct?'known':'unknown')
}
async function advance() {
  if (position.value+1>=queue.value.length) { await logTest(bankId.value,mode.value,started.value,answers.value); report.value=true; return }
  position.value++; input.value=''; selected.value=-1; choice.value=-1; submitted.value=false; hint.value=false
  if (current.value) { chunks.value=splitChunks(current.value.text); setChoices() }
}
function moveChunk(index:number,delta:number) { const next=index+delta; if(next<0||next>=chunks.value.length)return; const copy=[...chunks.value]; [copy[index],copy[next]]=[copy[next],copy[index]]; chunks.value=copy }
function onOption(event:Event) { const n=(event as CustomEvent<number>).detail; if(mode.value==='context'||mode.value==='cloze')choice.value=n }
function onSubmit() { if(submitted.value)void advance();else void check() }
onMounted(()=>{void start();window.addEventListener('memory:option',onOption);window.addEventListener('memory:submit',onSubmit)})
onUnmounted(()=>{window.removeEventListener('memory:option',onOption);window.removeEventListener('memory:submit',onSubmit)})
watch(bankId,start)
</script>

<template>
  <section class="section-heading"><div><span class="eyebrow">ACTIVE RECALL</span><h2>测试中心</h2><p>主动回想，再核对答案和字符差异。</p></div><label class="mode-select">训练方式<select v-model="mode" @change="start"><option v-for="item in modes" :key="item[0]" :value="item[0]">{{item[1]}}</option></select></label></section>
  <div class="test-progress"><span>本轮 {{Math.min(position+1,queue.length)}} / {{queue.length}}</span><div class="progress-track"><i :style="{width:progress+'%'}"></i></div><span>{{progress}}%</span></div>
  <section v-if="current&&!report" class="test-card">
    <div class="test-label">{{modes.find(item=>item[0]===mode)?.[1]}}</div>
    <template v-if="mode==='cloze'"><p class="test-prompt">{{current.text.replace(clozeTarget(current.text),'＿＿＿＿＿＿')}}</p><p class="field-help">选择句中缺失的单词。</p><div v-if="hint" class="initial-hint">首字母：{{clozeTarget(current.text).slice(0,1)}}……</div><div class="choice-list"><button v-for="(option,i) in clozeOptions" :key="i" :class="{chosen:choice===i,correct:submitted&&option===clozeTarget(current.text),incorrect:submitted&&choice===i&&option!==clozeTarget(current.text)}" @click="!submitted&&(choice=i)"><kbd>{{i+1}}</kbd>{{option}}</button></div><button class="soft-button" style="margin-top:9px" @click="hint=true">{{hint?'已显示首字提示':'显示首字提示'}}</button></template>
    <template v-else-if="mode==='dictation'"><div class="dictation-prompt"><span>凭记忆写出完整句子。</span><button class="soft-button" @click="hint=true">首字提示</button></div><p v-if="hint" class="initial-hint">{{[...current.text].filter((c,i)=>i===0||current.text[i-1]===' ').map(c=>c+'·').join(' ')}}</p><textarea v-model="input" :disabled="submitted" rows="4" placeholder="在这里默写整句……"></textarea><div v-if="submitted" class="diff-box"><b>字符级对照</b><p><span v-for="(part,i) in lcsDiff(current.text,input)" :key="i" :class="'diff-'+part.kind">{{part.char}}</span></p><small><i class="legend-missing"></i>目标中漏写 <i class="legend-extra"></i>多写</small></div></template>
    <template v-else-if="mode==='reorder'"><p class="test-prompt">把下面的句段排成正确顺序。</p><div class="chunk-list"><div v-for="(chunk,i) in chunks" :key="chunk+i" class="chunk-row"><span>{{chunk}}</span><button :disabled="i===0||submitted" @click="moveChunk(i,-1)">↑</button><button :disabled="i===chunks.length-1||submitted" @click="moveChunk(i,1)">↓</button></div></div><div v-if="submitted" class="diff-box"><b>排列结果</b><p>{{chunks.join(' ')}}</p><small>目标：{{current.text}}</small></div></template>
    <template v-else><p class="test-prompt">读完后，选择紧接着的下一句。</p><blockquote class="context-sentence">{{current.text}}</blockquote><div class="choice-list"><button v-for="(option,i) in contextOptions" :key="i" :class="{chosen:choice===i,correct:submitted&&option===sentences[sentences.findIndex(s=>s.id===current.id)+1]?.text,incorrect:submitted&&choice===i&&option!==sentences[sentences.findIndex(s=>s.id===current.id)+1]?.text}" @click="!submitted&&(choice=i)"><kbd>{{i+1}}</kbd>{{option}}</button></div></template>
    <div v-if="submitted" class="answer-feedback" :class="selected===1?'feedback-good':'feedback-bad'"><b>{{selected===1?'答对了，记得很牢。':'再见一面，记忆会更清晰。'}}</b><p v-if="mode==='cloze'">答案：{{clozeTarget(current.text)}}　·　{{current.text}}</p><p v-else-if="mode!=='context'">目标句：{{current.text}}</p><p v-else>下一句：{{sentences[sentences.findIndex(s=>s.id===current.id)+1]?.text||'没有后续句子'}}</p></div>
    <div class="test-actions"><button v-if="!submitted" class="button button-dark" :disabled="(mode==='context'||mode==='cloze')&&choice<0||(mode==='dictation'&&!input.trim())" @click="check">提交答案 <kbd>Enter</kbd></button><button v-else class="button button-dark" @click="advance">{{position+1>=queue.length?'查看本轮报告':'下一题 →'}} <kbd>Enter</kbd></button></div>
  </section>
  <section v-else-if="!report" class="empty-state panel"><span>☼</span><b>{{mode==='context'&&sentences.length<2?'上下句测试至少需要两句有顺序的句子':'当前句库还没有可测试的句子'}}</b><p>先添加句子，再开始测试。</p></section>
  <section v-else class="report-card"><span class="eyebrow">SESSION COMPLETE</span><h2>这一轮，完成得很好。</h2><div class="report-score"><b>{{answers.filter(a=>a.correct).length}}</b><span>/ {{answers.length}} 答对</span></div><div class="report-list"><div v-for="(answer,i) in answers" :key="i"><span :class="answer.correct?'result-check':'result-cross'">{{answer.correct?'✓':'↺'}}</span><span>{{sentences.find(s=>s.id===answer.sentenceId)?.text}}</span></div></div><button class="button button-dark" @click="start">再练一轮</button></section>
  <p class="keyboard-hint"><kbd>1–4</kbd> 选择 <span>·</span> <kbd>Enter</kbd> 提交 / 下一题</p>
</template>
