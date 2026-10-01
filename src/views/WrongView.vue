<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { db } from '../services/db'
import { markCard, wrongSentenceBankId } from '../services/engine'
import type { Sentence, WrongEntry } from '../types'
const store=useAppStore(),router=useRouter(),rows=ref<Array<{entry:WrongEntry;sentence:Sentence}>>([]),showAll=ref(false),wrongBookCount=ref(0)
const visible=computed(()=>showAll.value?rows.value:rows.value.slice(0,3))
async function load(){const entries=await db.wrongEntries.where('bankId').equals(store.bankId).reverse().sortBy('updatedAt');const out=[];for(const entry of entries){const sentence=await db.sentences.get(entry.sentenceId);if(sentence)out.push({entry,sentence})}rows.value=out;wrongBookCount.value=await db.sentences.where('bankId').equals(wrongSentenceBankId).count()}
async function practiced(sentenceId:string,result:'known'|'unknown'){await markCard(store.bankId,sentenceId,result);await load()}
async function reviewWrongBook(){if(!wrongBookCount.value)return;store.setBank(wrongSentenceBankId);await router.push('/initial')}
onMounted(load);watch(()=>store.bankId,load)
</script>
<template><section class="section-heading"><div><span class="eyebrow">GIVE THEM ANOTHER LOOK</span><h2>错句本</h2><p>答错的句子会在这里等待复习；连续答对 3 次后自动移出。</p></div><div class="wrong-heading-actions"><span class="wrong-count">{{rows.length}} <small>待巩固</small></span><button class="button button-dark" :disabled="!wrongBookCount" @click="reviewWrongBook">初记错句专项库 · {{wrongBookCount}} 句 →</button></div></section><div v-if="visible.length" class="wrong-list"><article v-for="(row,i) in visible" :key="row.entry.id" class="wrong-card"><div class="wrong-number">{{String(i+1).padStart(2,'0')}}</div><div class="wrong-body"><p>{{row.sentence.text}}</p><small>{{row.sentence.meaning||row.sentence.source||'还没有释义'}}</small><div class="wrong-meta"><span>答错 {{row.entry.wrongCount}} 次</span><span>连续答对 {{row.entry.correctStreak}} / 3</span></div></div><div class="wrong-actions"><button class="soft-button" @click="practiced(row.sentence.id,'unknown')">还不会</button><button class="button button-dark small-button" @click="practiced(row.sentence.id,'known')">会背了</button></div></article><button v-if="rows.length>3" class="show-more" @click="showAll=!showAll">{{showAll?'收起':'查看全部 '+rows.length+' 条'}} ↓</button></div><div v-else class="empty-state panel"><span>✳</span><b>这里暂时空空的</b><p>测试中不会的句子会自动来到这里。</p></div></template>
