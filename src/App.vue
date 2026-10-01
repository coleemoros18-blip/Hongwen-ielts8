<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { db } from './services/db'
import { stopStudyMusic } from './services/studyMusic'
import { APP_VERSION } from './version'
const store=useAppStore(), route=useRoute(), router=useRouter()
const progress=ref(0), title=computed(()=>String(route.meta.title||'练习室'))
const groupStudyMode=computed(()=>route.name==='browse'&&['initial','review'].includes(String(route.query.mode))&&!!route.query.groupId)
const nav=[{to:'/',label:'今日计划',icon:'◷'},{to:'/initial',label:'初记',icon:'✎'},{to:'/leisure',label:'休闲记忆',icon:'☼'},{to:'/review',label:'强化复习',icon:'↻'},{to:'/banks',label:'句库中心',icon:'▤'},{to:'/wrong',label:'错句本',icon:'↺'},{to:'/stats',label:'学习统计',icon:'▥'},{to:'/settings',label:'设置与备份',icon:'⚙'}]
watch(()=>route.fullPath,()=>{if(route.name!=='browse'||!['initial','review'].includes(String(route.query.mode)))stopStudyMusic()})
async function updateProgress(){ const total=await db.sentences.where('bankId').equals(store.bankId).count(); const mastered=await db.cardStates.where('[bankId+mastery]').equals([store.bankId,'mastered']).count(); progress.value=total?Math.round(mastered/total*100):0 }
let timer:number|undefined
function globalKeys(e:KeyboardEvent){ if(e.altKey||e.ctrlKey||e.metaKey||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement|| (e.target as HTMLElement)?.isContentEditable) return; if(e.code==='Space'&&route.name==='browse'){e.preventDefault();window.dispatchEvent(new CustomEvent('memory:flip'))} if(['1','2','3'].includes(e.key)&&route.name==='browse') window.dispatchEvent(new CustomEvent('memory:mark',{detail:Number(e.key)})); if(['1','2','3','4'].includes(e.key)&&route.name==='test') window.dispatchEvent(new CustomEvent('memory:option',{detail:Number(e.key)-1})); if(e.key==='Enter'&&route.name==='test') window.dispatchEvent(new CustomEvent('memory:submit')) }
watch(()=>store.bankId,updateProgress); onMounted(()=>{updateProgress();timer=window.setInterval(updateProgress,4000);window.addEventListener('keydown',globalKeys);window.addEventListener('beforeunload',()=>{void db.transaction('rw',db.meta,async()=>{await db.meta.put({key:'lastExit',value:new Date().toISOString()})})})});onUnmounted(()=>{clearInterval(timer);window.removeEventListener('keydown',globalKeys)})
function browse(){router.push(`/banks/${store.bankId}/browse`)}
</script>
<template>
  <div class="shell"><aside class="sidebar"><RouterLink to="/" class="brand"><span class="brand-mark">弘</span><span>弘文雅思8分<small>IELTS STUDY STUDIO · v{{ APP_VERSION }}</small></span></RouterLink><div class="side-label">学习空间</div><nav><RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="nav-link" active-class="active"><span>{{item.icon}}</span>{{item.label}}<i v-if="item.to==='/wrong'">错句</i></RouterLink></nav><div class="side-spacer"></div><div class="side-tip"><span class="tip-dot"></span><div><b>本地保存已开启</b><small>数据只保存在此设备</small></div></div><div class="side-foot">离线可用 · 无需账号</div></aside>
    <main class="main"><header class="topbar" :class="{'group-study-topbar':groupStudyMode}"><div class="topbar-page-title"><div class="eyebrow">YOUR PRIVATE STUDY DESK</div><h1>{{title}}</h1></div><div v-if="groupStudyMode" id="topbar-study-center" class="topbar-study-center"></div><div class="top-right"><label class="bank-select"><span>当前句库</span><select v-model="store.bankId" @focus="store.refreshBanks()"><option v-for="bank in store.banks" :key="bank.id" :value="bank.id">{{bank.name}}</option></select></label><div class="top-progress"><div class="progress-label"><span>熟练进度</span><b>{{progress}}%</b></div><div class="progress-track"><span :style="{width:progress+'%'}"></span></div></div></div></header><div class="content"><RouterView/></div><footer class="page-footer"><span>静下来，记住一句好句子。</span><span><kbd>Space</kbd> 翻卡 <b>·</b> <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 标记</span></footer></main></div>
</template>
