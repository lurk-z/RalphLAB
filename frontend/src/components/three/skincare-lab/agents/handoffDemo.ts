import type { Role } from './workflow'
import { assessmentText } from '@/lib/lab-demo/chat-assessment'

import { BRIEF, HANDOFFS, RESULTS, type Version } from '@/lib/lab-demo/study-example'
export { BRIEF, HANDOFFS }
export type { Version }
export type Progress = { index: number; delivered: boolean }

export function sampleRecord(version: Version, progress: Progress) {
  const resultIndex = HANDOFFS.findIndex(row => row.version === version && row.releasesResults)
  const results = progress.index > resultIndex || (progress.index === resultIndex && progress.delivered)
    ? assessmentText(RESULTS[version])
    : 'รอผลคัดกรองทั้งสี่ด้าน'
  const sample = HANDOFFS.find(row => row.version === version && row.item === 'sample')!
  return ['D01-' + version, sample.note, results].join('\n')
}

export function roleWork(role: Role, progress: Progress) {
  return HANDOFFS.slice(0, progress.index + 1).map((row, index) => ({ row, index }))
    .filter(({ row }) => row.from === role || row.to === role)
}

export function demoReply(role: Role, progress: Progress) {
  const work = roleWork(role, progress).at(-1)
  if (!work) return 'ยังไม่มีใบงานมาถึงสถานีนี้\n' + BRIEF
  const { row, index } = work
  const pending = index === progress.index && !progress.delivered
  const status = row.from === role
    ? (pending ? 'กำลังเตรียมและนำส่ง' : 'ส่งงานแล้ว')
    : (pending ? 'กำลังรอรับ' : 'ได้รับงานแล้ว')
  return [status + ' · ' + row.title, row.note, row.version && sampleRecord(row.version, progress)].filter(Boolean).join('\n\n')
}
