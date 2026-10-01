export type BankKind = 'builtin' | 'custom'
export type Mastery = 'new' | 'learning' | 'fuzzy' | 'mastered'
export interface Bank { id: string; name: string; description: string; kind: BankKind; createdAt: string; updatedAt: string }
export interface Sentence { id: string; bankId: string; text: string; meaning: string; source: string; order: number; createdAt: string; originBankId?: string; originSentenceId?: string }
export interface CardState { id: string; bankId: string; sentenceId: string; mastery: Mastery; dueAt: string; intervalDays: number; repetitions: number; ease: number; streak: number; attempts: number; lastResult?: 'known'|'fuzzy'|'unknown'; updatedAt: string; browseCursor?: number }
export interface TestAnswer { sentenceId: string; prompt: string; answer: string; correct: boolean; mode: string }
export interface TestRecord { id: string; bankId: string; mode: string; startedAt: string; endedAt: string; correct: number; total: number; answers: TestAnswer[] }
export interface WrongEntry { id: string; bankId: string; sentenceId: string; wrongCount: number; correctStreak: number; wrongStreak?: number; updatedAt: string }
export interface StatsDaily { id: string; bankId: string; date: string; reviewed: number; correct: number; minutes: number; newLearned: number }
export interface StudyGroup { id: string; bankId: string; groupNumber: number; sentenceIds: string[]; completedAt: string; lastReviewedAt: string; reviewCount: number; nextReviewAt: string }
