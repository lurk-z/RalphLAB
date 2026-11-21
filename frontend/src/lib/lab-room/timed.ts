/**
 * Timed studies (Cloud `integrations/timed-studies/worker/timed.js`) · read-only model for the room.
 *
 * The Cloud worker authenticates with the Cloud site's own session, so local Next cannot read
 * a real study. This module keeps the worker's exact record shape and rules (signal, report,
 * owner decision with a version check) so a live adapter can replace the fixture, and so a
 * replayed LINE decision updates the same study once.
 */

export const CLOUD_SITE = 'https://ralphlab-workbench.surawit2003it.chatgpt.site'
const HOUR = 3600000

export type TimedResult = { value: number; observed: number; recorded: number; source: string; note: string; issue: boolean }
export type TimedRound = { hour: number; due: number; result?: TimedResult; followup?: string }
export type TimedNote = { action: 'issue' | 'continue' | 'stop' | 'followup'; note: string; at: number; via: 'web' | 'LINE' }
export type TimedRow = {
  id: string
  brief: string
  goal: string
  condition: string
  metric: string
  unit: string
  exception: string
  duration: number
  rule: { direction: 'above' | 'below'; limit: number } | null
  rounds: TimedRound[]
  start: number
  state: 'active' | 'paused' | 'complete' | 'stopped'
  version: number
  notes: TimedNote[]
  problem?: string
}
export type TimedSignal = 'due' | 'issue' | 'report' | 'observation'

export const STATE_TH: Record<TimedRow['state'], string> = {
  active: 'กำลังติดตาม',
  paused: 'พักงาน · รอเจ้าของตอบ',
  complete: 'รายงานเสร็จแล้ว',
  stopped: 'ยุติการติดตาม',
}

export function timedNext(row: TimedRow) {
  return row.rounds.find((r) => !r.result)
}

export function timedSignal(row: TimedRow, now: number): TimedSignal {
  if (row.state === 'paused') return 'issue'
  if (row.state === 'complete' || row.state === 'stopped') return 'report'
  return (timedNext(row)?.due ?? Infinity) <= now ? 'due' : 'observation'
}

export function timedReport(row: TimedRow) {
  const values = row.rounds.filter((r) => r.result).map((r) => r.result!.value)
  return {
    count: values.length,
    total: row.rounds.length,
    delta: values.length > 1 ? values.at(-1)! - values[0] : null,
    last: values.at(-1) ?? null,
    unit: row.unit,
  }
}

export class TimedConflict extends Error {}

/**
 * The owner's answer to a paused study (from the web or a LINE reply). It applies only to the
 * version it was given for: a repeated or late reply changes nothing (the worker answers 409).
 */
export function applyTimedDecision(row: TimedRow, b: { action: 'continue' | 'stop' | 'followup'; note: string; version: number; hours?: number },
  now: number, via: 'web' | 'LINE'): TimedRow {
  if (row.version !== b.version) throw new TimedConflict('ข้อมูลเปลี่ยนแล้ว โปรดเปิดใบงานล่าสุด')
  if (row.state !== 'paused') throw new TimedConflict('ยังไม่มีประเด็นรอการตัดสินใจ')
  const next: TimedRow = structuredClone(row)
  if (b.action === 'followup') {
    const due = now + (b.hours ?? 0) * HOUR
    if (!b.hours || next.rounds.some((r) => r.due === due)) throw new TimedConflict('รอบซ้ำหรือจำนวนรอบเกินกำหนด')
    next.rounds.push({ hour: (due - next.start) / HOUR, due, followup: b.note })
    next.rounds.sort((a, c) => a.due - c.due)
  }
  next.state = b.action === 'stop' ? 'stopped' : timedNext(next) ? 'active' : 'complete'
  next.notes.push({ action: b.action, note: b.note, at: now, via })
  next.version++
  return next
}

/**
 * The team's example: watch a cleanser's colour at 0, 1, 24 and 48 hours. One value has been
 * measured; the 1-hour round found a problem, so the study is paused for the owner.
 */
export function colorChangeFixture(now: number): TimedRow {
  const start = now - 2 * HOUR
  const round = (hour: number): TimedRound => ({ hour, due: start + hour * HOUR })
  const rounds = [0, 1, 24, 48].map(round)
  rounds[0].result = { value: 0.4, observed: start + 5 * 60000, recorded: start + 6 * 60000, source: 'ภาพถ่ายขวด V1 รอบ 0 ชม. (ข้อมูลจำลอง)', note: 'สีใสตามปกติ', issue: false }
  return {
    id: 'demo-color-change',
    brief: 'ติดตามการเปลี่ยนสี',
    goal: 'ตรวจว่าสีของสูตร V1 เปลี่ยนเกินเกณฑ์ระหว่างเก็บหรือไม่',
    condition: 'เก็บที่ 40 °C ในขวดใส',
    metric: 'ค่าความต่างสี',
    unit: 'ΔE',
    exception: 'พักงานเมื่อพบตะกอนหรือ ΔE เกิน 3',
    duration: 48,
    rule: { direction: 'above', limit: 3 },
    rounds,
    start,
    state: 'paused',
    version: 3,
    problem: 'รอบ 1 ชั่วโมงพบตะกอนเล็กน้อยที่ก้นขวดก่อนวัดสี',
    notes: [{ action: 'issue', note: 'รอบ 1 ชั่วโมงพบตะกอนเล็กน้อยที่ก้นขวดก่อนวัดสี', at: start + HOUR + 10 * 60000, via: 'web' }],
  }
}

/** Who acts next, by the timed-study role codes (the Cloud team's tools). */
export function nextActor(row: TimedRow, now: number) {
  switch (timedSignal(row, now)) {
    case 'issue': return { who: 'เจ้าของโครงการ', what: 'ตัดสินใจ: ติดตามต่อ เพิ่มรอบ หรือยุติ' }
    case 'due': return { who: 'ผู้วัดค่า · นักวิเคราะห์ (analyst)', what: 'บันทึกค่าที่วัดพร้อมหน่วยและหลักฐาน' }
    case 'report': return { who: 'ผู้ประเมิน (evaluator)', what: 'อ่านรายงานและหลักฐานที่ขาด' }
    default: return { who: 'ผู้วัดค่า · นักวิเคราะห์ (analyst)', what: 'รอถึงรอบวัดถัดไป' }
  }
}

export function cloudStudyHref(id: string, fixture: boolean) {
  return fixture ? `${CLOUD_SITE}/lab-room/timed` : `${CLOUD_SITE}/lab-room/timed?id=${encodeURIComponent(id)}`
}
export function cloudTeamHref(id: string, fixture: boolean) {
  return fixture ? `${CLOUD_SITE}/lab-room/team` : `${CLOUD_SITE}/lab-room/team?study=${encodeURIComponent(id)}`
}
