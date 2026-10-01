<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useAppStore } from '../stores/app'
import { db } from '../services/db'
import { dailyQueue } from '../services/engine'
import type { Sentence, CardState } from '../types'
const store=useAppStore(), queue=ref<Array<{sentence:Sentence;state:CardState}>>([]), total=ref(0), learned=ref(0)
const greeting=computed(()=>{const h=new Date().getHours();return h<11?'早上好':h<18?'下午好':'晚上好'})
async function load(){queue.value=await dailyQueue(store.bankId);total.value=await db.sentences.where('bankId').equals(store.bankId).count();learned.value=await db.cardStates.where('[bankId+mastery]').equals([store.bankId,'mastered']).count()}
onMounted(load);watch(()=>store.bankId,load)
</script>
<template><section class="hero-card"><div class="hero-copy"><span class="eyebrow light">A LITTLE PRACTICE, EVERY DAY</span><h2>{{greeting}}，<br>今天记住一句。</h2><p>不用赶进度。把注意力放在眼前这一句就好。</p><RouterLink :to="`/banks/${store.bankId}/browse`" class="button button-light">开始今日练习 <span>↗</span></RouterLink></div><div class="hero-orbit"><div class="orbit-ring ring-one"></div><div class="orbit-ring ring-two"></div><div class="orbit-center"><span>今日</span><b>{{queue.length}}</b><small>待复习</small></div><span class="orbit-spark spark-one">✳</span><span class="orbit-spark spark-two">✦</span></div></section>
<section class="stat-row"><div class="stat-card"><span class="stat-icon lilac">▤</span><div><small>句库句子</small><b>{{total}}</b></div><span class="stat-note">条收录</span></div><div class="stat-card"><span class="stat-icon sage">✓</span><div><small>已经熟练</small><b>{{learned}}</b></div><span class="stat-note">条记住</span></div><div class="stat-card"><span class="stat-icon peach">◷</span><div><small>今日待练</small><b>{{queue.length}}</b></div><span class="stat-note">条复习</span></div></section>
<section class="section-heading"><div><span class="eyebrow">TODAY'S ROUTINE</span><h2>今天的安排</h2><p>到期优先，接着复习模糊的，再认识新句。</p></div><RouterLink :to="`/banks/${store.bankId}/test`" class="text-link">去测试中心 <span>→</span></RouterLink></section>
<div class="routine-card"><div v-if="queue.length" class="routine-items"><div v-for="(item,i) in queue.slice(0,5)" :key="item.sentence.id" class="routine-item"><span class="routine-index">{{String(i+1).padStart(2,'0')}}</span><div class="routine-text"><b>{{item.sentence.text}}</b><small>{{item.sentence.source||'自定义句子'}}</small></div><span class="pill" :class="'pill-'+(item.state?.mastery||'new')">{{item.state?.mastery==='fuzzy'?'模糊':item.state?.mastery==='new'?'新句':'复习'}}</span></div><RouterLink v-if="queue.length>5" :to="`/banks/${store.bankId}/browse`" class="show-more">查看全部 {{queue.length}} 条 →</RouterLink></div><div v-else class="empty-state"><span>☼</span><b>今天的复习完成了</b><p>可以去句库挑选几句新内容。</p><RouterLink to="/banks" class="text-link">浏览句库 →</RouterLink></div></div>
<div class="bottom-note"><span class="note-mark">✳</span><p>记忆不是一次完成的事。<b>恰好在快要忘记时再遇见，</b>会让它留得更久。</p></div></template>
