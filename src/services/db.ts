import Dexie, { type EntityTable } from 'dexie'
import type { Bank, Sentence, CardState, TestRecord, WrongEntry, StatsDaily, StudyGroup } from '../types'
import factoryBanks from '../data/factory-banks.json'

export class MemoryDB extends Dexie {
  banks!: EntityTable<Bank, 'id'>
  sentences!: EntityTable<Sentence, 'id'>
  cardStates!: EntityTable<CardState, 'id'>
  testRecords!: EntityTable<TestRecord, 'id'>
  wrongEntries!: EntityTable<WrongEntry, 'id'>
  statsDaily!: EntityTable<StatsDaily, 'id'>
  studyGroups!: EntityTable<StudyGroup, 'id'>
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>
  constructor() {
    super('sentence-memory')
    this.version(1).stores({ banks: 'id, kind, updatedAt', sentences: 'id, bankId, [bankId+order], [bankId+createdAt]', cardStates: 'id, bankId, sentenceId, [bankId+sentenceId], [bankId+dueAt], [bankId+mastery]', testRecords: 'id, bankId, endedAt, [bankId+endedAt], [mode+endedAt]', wrongEntries: 'id, bankId, sentenceId, [bankId+sentenceId], [bankId+updatedAt]', statsDaily: 'id, bankId, date, [bankId+date]', meta: 'key' })
    this.version(2).stores({ banks: 'id, kind, updatedAt', sentences: 'id, bankId, [bankId+order], [bankId+createdAt]', cardStates: 'id, bankId, sentenceId, [bankId+sentenceId], [bankId+dueAt], [bankId+mastery]', testRecords: 'id, bankId, endedAt, [bankId+endedAt], [mode+endedAt]', wrongEntries: 'id, bankId, sentenceId, [bankId+sentenceId], [bankId+updatedAt]', statsDaily: 'id, bankId, date, [bankId+date]', studyGroups: 'id, bankId, groupNumber, [bankId+nextReviewAt]', meta: 'key' })
  }
}
export const db = new MemoryDB()
export const id = () => crypto.randomUUID()
export const today = () => new Date().toISOString().slice(0, 10)

export async function ensureSeed() {
  const now = new Date().toISOString()
  await db.transaction('rw', db.banks, db.sentences, db.cardStates, db.meta, async () => {
    const existingBanks = await db.banks.toArray()
    for (const pack of factoryBanks) {
      const marker = `factory-bank:v1:${pack.id}`
      if (await db.meta.get(marker)) continue

      // A prior version shipped five sample rows under sample-bank. Keep their
      // records, then merge the full factory corpus without duplicating rows.
      const existingBank = await db.banks.get(pack.id)
        ?? existingBanks.find(bank => bank.name === pack.name)
      const bankId = existingBank?.id ?? pack.id
      if (!existingBank) {
        const bank: Bank = {
          id: bankId,
          name: pack.name,
          description: `出厂内置雅思学习词库，共 ${pack.sentences.length} 条。`,
          kind: 'builtin',
          createdAt: now,
          updatedAt: now,
        }
        await db.banks.add(bank)
        existingBanks.push(bank)
      }

      const current = await db.sentences.where('bankId').equals(bankId).toArray()
      const known = new Set(current.map(sentence => `${sentence.text}\u0000${sentence.meaning}`))
      let nextOrder = current.reduce((max, sentence) => Math.max(max, sentence.order), -1) + 1
      const newSentences: Sentence[] = []
      const newStates: CardState[] = []
      for (const [index, item] of pack.sentences.entries()) {
        const identity = `${item.text}\u0000${item.meaning}`
        if (known.has(identity)) continue
        known.add(identity)
        const sentenceId = `factory:${pack.id}:${index + 1}`
        newSentences.push({
          id: sentenceId,
          bankId,
          text: item.text,
          meaning: item.meaning,
          source: item.source,
          order: nextOrder++,
          createdAt: now,
        })
        newStates.push({
          id: `${bankId}:${sentenceId}`,
          bankId,
          sentenceId,
          mastery: 'new',
          dueAt: now,
          intervalDays: 0,
          repetitions: 0,
          ease: 2.5,
          streak: 0,
          attempts: 0,
          updatedAt: now,
        })
      }
      if (newSentences.length) {
        await db.sentences.bulkAdd(newSentences)
        await db.cardStates.bulkAdd(newStates)
      }
      await db.meta.put({ key: marker, value: { bankId, importedAt: now } })
    }
  })
}
