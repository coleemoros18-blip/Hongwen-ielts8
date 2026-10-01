import { isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { BaseDirectory, mkdir, readDir, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { db } from './db'

export async function startupBackup() {
  if (!isTauri()) return
  try {
    const names = ['banks','sentences','cardStates','testRecords','wrongEntries','statsDaily','studyGroups','meta'] as const
    const backup: Record<string, unknown> = { format: 'sentence-memory-backup', version: 2, exportedAt: new Date().toISOString() }
    for (const name of names) backup[name] = await db.table(name).toArray()
    await mkdir('backups', { baseDir: BaseDirectory.AppData, recursive: true })
    const filename = `sentence-memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    await writeTextFile(await join('backups', filename), JSON.stringify(backup), { baseDir: BaseDirectory.AppData })
    const entries = await readDir('backups', { baseDir: BaseDirectory.AppData })
    const backups = entries.filter(entry => entry.isFile && /^sentence-memory-.*\.json$/.test(entry.name)).sort((a,b) => a.name.localeCompare(b.name))
    for (const expired of backups.slice(0, Math.max(0, backups.length - 7))) await remove(await join('backups', expired.name), { baseDir: BaseDirectory.AppData })
  } catch (error) {
    console.warn('Automatic local backup failed:', error)
  }
}
