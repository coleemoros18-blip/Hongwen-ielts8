import { db, id, today } from './db'
import type { CardState, Mastery, Sentence } from '../types'

export const stateId = (bankId: string, sentenceId: string) => `${bankId}:${sentenceId}`
export const wrongSentenceBankId = 'wrong-sentence-bank'
export async function getOrCreateState(bankId: string, sentenceId: string) {
  const key = stateId(bankId, sentenceId)
  let state = await db.cardStates.get(key)
  if (!state) { state = { id: key, bankId, sentenceId, mastery: 'new', dueAt: new Date().toISOString(), intervalDays: 0, repetitions: 0, ease: 2.5, streak: 0, attempts: 0, updatedAt: new Date().toISOString() }; await db.cardStates.put(state) }
  return state
}
export async function markCard(bankId: string, sentenceId: string, result: 'known'|'fuzzy'|'unknown') {
  const state = await getOrCreateState(bankId, sentenceId)
  const now = new Date(); const next: CardState = { ...state, attempts: state.attempts + 1, lastResult: result, updatedAt: now.toISOString() }
  if (result === 'known') {
    next.repetitions += 1; next.streak += 1; next.ease = Math.max(1.3, next.ease + 0.08)
    next.intervalDays = next.repetitions === 1 ? 1 : next.repetitions === 2 ? 3 : Math.max(1, Math.round(state.intervalDays * next.ease))
    next.mastery = next.streak >= 3 && next.intervalDays >= 14 ? 'mastered' : 'learning'
    next.dueAt = new Date(now.getTime() + next.intervalDays * 86400000).toISOString()
  } else {
    next.streak = 0; next.intervalDays = result === 'unknown' ? 0 : Math.max(1, Math.round(state.intervalDays * 0.35)); next.ease = Math.max(1.3, next.ease - (result === 'unknown' ? 0.2 : 0.1)); next.mastery = result === 'fuzzy' ? 'fuzzy' : 'learning'; next.dueAt = new Date(now.getTime() + (result === 'unknown' ? 10 : 60) * 60000).toISOString()
  }
  await db.cardStates.put(next)
  if (result === 'unknown') {
    const existing = await db.wrongEntries.where('[bankId+sentenceId]').equals([bankId, sentenceId]).first()
    const wrongStreak = (existing?.wrongStreak ?? 0) + 1
    await db.wrongEntries.put({ id: existing?.id ?? `${bankId}:${sentenceId}`, bankId, sentenceId, wrongCount: (existing?.wrongCount ?? 0) + 1, correctStreak: 0, wrongStreak, updatedAt: now.toISOString() })
    if (wrongStreak >= 3 && bankId !== wrongSentenceBankId) await addToWrongSentenceBank(bankId, sentenceId)
  } else if (result === 'known') {
    const existing = await db.wrongEntries.where('[bankId+sentenceId]').equals([bankId, sentenceId]).first()
    if (existing) { const streak = existing.correctStreak + 1; if (streak >= 3) await db.wrongEntries.delete(existing.id); else await db.wrongEntries.update(existing.id, { correctStreak: streak, wrongStreak: 0, updatedAt: now.toISOString() }) }
  } else {
    const existing = await db.wrongEntries.where('[bankId+sentenceId]').equals([bankId, sentenceId]).first()
    if (existing) await db.wrongEntries.update(existing.id, { correctStreak: 0, wrongStreak: 0, updatedAt: now.toISOString() })
  }
  const key = `${bankId}:${today()}`; const daily = await db.statsDaily.get(key)
  await db.statsDaily.put({ id: key, bankId, date: today(), reviewed: (daily?.reviewed ?? 0) + 1, correct: (daily?.correct ?? 0) + (result === 'known' ? 1 : 0), minutes: daily?.minutes ?? 0, newLearned: (daily?.newLearned ?? 0) + (state.mastery === 'new' ? 1 : 0) })
  return next
}
async function addToWrongSentenceBank(sourceBankId: string, sourceSentenceId: string) {
  const source = await db.sentences.get(sourceSentenceId)
  if (!source || source.bankId !== sourceBankId) return
  const now = new Date().toISOString()
  const [bank, sentenceCount] = await Promise.all([
    db.banks.get(wrongSentenceBankId),
    db.sentences.where('bankId').equals(wrongSentenceBankId).count(),
  ])
  const sentenceId = `wrong:${sourceBankId}:${sourceSentenceId}`
  const existingCopy = await db.sentences.get(sentenceId)
  await db.transaction('rw', db.banks, db.sentences, db.cardStates, async () => {
    if (!bank) await db.banks.put({ id: wrongSentenceBankId, name: '错句专项库', description: '连续 3 次答错的句子汇总。可在初记中独立分组重新背诵。', kind: 'custom', createdAt: now, updatedAt: now })
    if (!existingCopy) {
      const copy: Sentence = { id: sentenceId, bankId: wrongSentenceBankId, text: source.text, meaning: source.meaning, source: source.source || '连续答错 3 次', order: sentenceCount, createdAt: now, originBankId: sourceBankId, originSentenceId: sourceSentenceId }
      await db.sentences.add(copy)
      await db.cardStates.put({ id: stateId(wrongSentenceBankId, sentenceId), bankId: wrongSentenceBankId, sentenceId, mastery: 'new', dueAt: now, intervalDays: 0, repetitions: 0, ease: 2.5, streak: 0, attempts: 0, updatedAt: now })
    }
  })
}
export async function dailyQueue(bankId: string): Promise<Array<{sentence: Sentence; state: CardState}>> {
  const sentences = await db.sentences.where('bankId').equals(bankId).sortBy('order')
  const states = await db.cardStates.where('bankId').equals(bankId).toArray(); const byId = new Map(states.map(s => [s.sentenceId, s])); const now = Date.now()
  const wrong = new Set((await db.wrongEntries.where('bankId').equals(bankId).toArray()).map(entry => entry.sentenceId))
  const dailyTarget = Math.max(1, Number(localStorage.getItem('dailyTarget') || 10))
  const progress = await db.statsDaily.get(`${bankId}:${today()}`)
  const newLimit = Math.max(0, dailyTarget - (progress?.newLearned ?? 0))
  const rows = sentences.map(sentence => ({ sentence, state: byId.get(sentence.id)! }))
  const urgent = rows.filter(x => wrong.has(x.sentence.id) || (x.state?.mastery !== 'new' && x.state && new Date(x.state.dueAt).getTime() <= now))
  const fresh = rows.filter(x => !wrong.has(x.sentence.id) && x.state?.mastery === 'new').slice(0, newLimit)
  return [...urgent, ...fresh].sort((a,b) => (wrong.has(a.sentence.id) ? -1 : priority(a.state)) - (wrong.has(b.sentence.id) ? -1 : priority(b.state)) || (a.state?.dueAt ?? '').localeCompare(b.state?.dueAt ?? ''))
}
function priority(s?: CardState) { if (!s) return 3; if (s.mastery === 'fuzzy') return 2; if (s.mastery === 'new') return 3; return 1 }
export function utf8Bytes(text: string) { return new TextEncoder().encode(text).length }
export function lcsDiff(a: string, b: string) {
  const x = [...a], y = [...b], dp = Array.from({length:x.length+1},()=>new Uint16Array(y.length+1))
  for(let i=x.length-1;i>=0;i--) for(let j=y.length-1;j>=0;j--) dp[i][j] = x[i]===y[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1])
  const out: Array<{char:string;kind:'same'|'missing'|'extra'}> = []; let i=0,j=0
  while(i<x.length||j<y.length) { if(i<x.length&&j<y.length&&x[i]===y[j]) {out.push({char:x[i++],kind:'same'});j++} else if(i<x.length&&(j===y.length||dp[i+1][j]>=dp[i][j+1])) out.push({char:x[i++],kind:'missing'}); else out.push({char:y[j++],kind:'extra'}) }
  return out
}
export function maskSentence(text: string, ratio = 0.38) { const chars=[...text]; const words = [...text.matchAll(/[A-Za-z][A-Za-z'-]*/g)]; if(!words.length) return text.replace(/[\p{L}\p{N}]/gu,'＿'); let remove=0; return text.replace(/[A-Za-z][A-Za-z'-]*/g, word => { const hide=remove++/words.length < ratio; return hide ? '＿'.repeat([...word].length) : word }) }
export function masteryLabel(value: Mastery) { return ({new:'新句',learning:'学习中',fuzzy:'模糊',mastered:'熟练'} as const)[value] }
export async function logTest(bankId: string, mode: string, startedAt: string, answers: Array<{sentenceId:string;prompt:string;answer:string;correct:boolean}>) { const record={id:id(),bankId,mode,startedAt,endedAt:new Date().toISOString(),correct:answers.filter(a=>a.correct).length,total:answers.length,answers:answers.map(a=>({...a,mode}))}; await db.testRecords.add(record); return record }
