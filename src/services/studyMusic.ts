const settingKey = 'studyBackgroundMusicEnabled'
const recordingUrl = 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Mozart_-_Piano_Sonata_No._11_in_A_major_-_I._Andante_grazioso.ogg'
let player: HTMLAudioElement | undefined

export function isStudyMusicEnabled() {
  return localStorage.getItem(settingKey) !== 'false'
}

export function setStudyMusicPreference(enabled: boolean) {
  localStorage.setItem(settingKey, String(enabled))
  if (!enabled) stopStudyMusic()
}

export async function startStudyMusic() {
  if (!isStudyMusicEnabled()) return false
  if (!player) {
    player = new Audio(recordingUrl)
    player.loop = true
    player.preload = 'none'
    player.volume = 0.18
  }
  try {
    await player.play()
    return true
  } catch {
    return false
  }
}

export function stopStudyMusic() {
  if (!player) return
  player.pause()
  player.currentTime = 0
}

export async function setStudyMusicEnabled(enabled: boolean) {
  localStorage.setItem(settingKey, String(enabled))
  if (enabled) return startStudyMusic()
  stopStudyMusic()
  return true
}
