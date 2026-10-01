import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { db } from '../services/db'
import type { Bank } from '../types'
export const useAppStore = defineStore('app', () => {
  const bankId = ref(localStorage.getItem('activeBankId') || 'sample-bank')
  const banks = ref<Bank[]>([])
  async function refreshBanks() { banks.value = await db.banks.orderBy('updatedAt').reverse().toArray(); if (!banks.value.some(b => b.id === bankId.value) && banks.value[0]) bankId.value = banks.value[0].id }
  function setBank(id: string) { bankId.value = id }
  watch(bankId, value => localStorage.setItem('activeBankId', value))
  void refreshBanks()
  return { bankId, banks, refreshBanks, setBank }
})
