'use client'

import { useCallback, useEffect, useState } from 'react'
import { applyTimedDecision, colorChangeFixture, TimedConflict, type TimedRow } from '@/lib/lab-room/timed'

const KEY = 'ralphlab:timed-fixture:v1:'

/** The LINE reply the fixture replays. It names the version it answers, like the real relay. */
export const FIXTURE_LINE_REPLY = { action: 'followup' as const, hours: 6, note: 'เพิ่มรอบวัดหลังกรองตะกอนออก 6 ชั่วโมง', version: 3 }

/**
 * A timed study for the room. The fixture (`study=demo-color-change`) lives in this browser per
 * viewer, so a refresh shows the same rounds and decisions. A real Cloud study cannot be read
 * from Next (the worker uses the Cloud site's own session): `row` stays null with that reason.
 */
export function useTimedStudy(studyId: string, fixture: boolean, viewer: string) {
  const [row, setRow] = useState<TimedRow | null>(null)
  const [message, setMessage] = useState('')
  const key = KEY + viewer
  useEffect(() => {
    if (!fixture) return
    let saved: TimedRow | null = null
    try { saved = JSON.parse(window.localStorage.getItem(key) || 'null') } catch { /* Storage is optional. */ }
    const next = saved?.id === studyId ? saved : colorChangeFixture(Date.now())
    setRow(next)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* Kept in memory. */ }
  }, [fixture, key, studyId])

  const save = useCallback((next: TimedRow) => {
    setRow(next)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* Kept in memory. */ }
  }, [key])

  /** Replay the owner's LINE reply into the same study. A repeat changes nothing. */
  const replayLineReply = useCallback(() => {
    if (!row) return
    try {
      save(applyTimedDecision(row, FIXTURE_LINE_REPLY, Date.now(), 'LINE'))
      setMessage('รับคำตอบจาก LINE แล้ว · บันทึกในใบงานเดิมครั้งเดียว')
    } catch (error) {
      setMessage(error instanceof TimedConflict ? `ไม่บันทึกซ้ำ · ${error.message}` : 'บันทึกคำตอบไม่สำเร็จ')
    }
  }, [row, save])

  const resetFixture = useCallback(() => {
    save(colorChangeFixture(Date.now()))
    setMessage('')
  }, [save])

  return { row, message, replayLineReply, resetFixture, available: fixture }
}
