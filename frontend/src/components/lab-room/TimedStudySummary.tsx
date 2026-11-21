'use client'

import { CircleAlert, ExternalLink, Network, RotateCcw, Users } from 'lucide-react'
import { cloudStudyHref, cloudTeamHref, nextActor, STATE_TH, timedNext, timedReport, timedSignal } from '@/lib/lab-room/timed'
import type { useTimedStudy } from './useTimedStudy'

const stamp = (ms: number) => new Date(ms).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Read-only work summary of a timed study: what is watched, the next observation, the last
 * measured value with its unit, who acts next and where the evidence is. Recording values and
 * owner decisions stay in the existing timed-study tool.
 */
export default function TimedStudySummary({ studyId, fixture, timed, onOpenGraph }: {
  studyId: string
  fixture: boolean
  timed: ReturnType<typeof useTimedStudy>
  onOpenGraph: () => void
}) {
  const row = timed.row
  const cloud = <div className="flex flex-wrap gap-2">
    <a href={cloudStudyHref(studyId, fixture)} target="_blank" rel="noopener noreferrer" className="lab-room-chip"><ExternalLink aria-hidden="true" />เปิดใน Cloud</a>
    <a href={cloudTeamHref(studyId, fixture)} target="_blank" rel="noopener noreferrer" className="lab-room-chip"><Users aria-hidden="true" />ทีม Agent ใน Cloud</a>
  </div>
  if (!row) {
    return <section aria-label="ใบงานตามเวลา" className="space-y-3 text-sm text-slate-700">
      <h2 className="text-base font-semibold text-slate-900">ใบงานตามเวลา</h2>
      <p>{fixture ? 'กำลังเปิดตัวอย่าง…' : 'ข้อมูลใบงานนี้อยู่บน Cloud และผูกกับบัญชีเจ้าของ ห้องในแอปนี้ยังอ่านโดยตรงไม่ได้ · เปิดใน Cloud เพื่อบันทึกค่าและตัดสินใจ'}</p>
      {cloud}
    </section>
  }
  const now = Date.now()
  const next = timedNext(row)
  const report = timedReport(row)
  const last = [...row.rounds].reverse().find((r) => r.result)
  const actor = nextActor(row, now)
  const signal = timedSignal(row, now)
  return (
    <section aria-label={`ใบงานตามเวลา · ${row.brief}`} className="space-y-3 text-sm text-slate-700" data-timed-state={row.state} data-timed-version={row.version}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{row.brief}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${row.state === 'paused' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-teal-50 text-teal-800 ring-teal-200'}`}>{STATE_TH[row.state]}</span>
        {fixture && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">ข้อมูลจำลอง</span>}
      </header>
      <p className="text-slate-600">{row.goal}</p>
      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-slate-500">รอบถัดไป</dt>
        <dd>{next ? `${Math.round(next.hour * 10) / 10} ชม. · ${stamp(next.due)}${next.due <= now ? ' (ถึงรอบแล้ว)' : ''}` : 'ครบทุกรอบแล้ว'}</dd>
        <dt className="text-slate-500">ค่าล่าสุด</dt>
        <dd data-last-value>{report.last === null ? 'ยังไม่มีค่า' : `${report.last} ${row.unit} · ${row.metric}`}</dd>
        <dt className="text-slate-500">ผู้ทำต่อ</dt>
        <dd>{actor.who} · {actor.what}</dd>
        <dt className="text-slate-500">หลักฐาน</dt>
        <dd>{last?.result ? <>{last.result.source} <span className="text-slate-500">· ยังไม่มีลิงก์ต้นฉบับ</span></> : 'ยังไม่มีหลักฐาน'}</dd>
      </dl>

      <table className="w-full text-left text-xs">
        <caption className="sr-only">รอบวัดตามแผนและค่าที่บันทึกจริง</caption>
        <thead className="text-slate-500"><tr><th className="py-1">รอบ</th><th>นัดวัด</th><th>วัดจริง</th><th>ค่า ({row.unit})</th></tr></thead>
        <tbody>
          {row.rounds.map((r) => <tr key={r.due} className="border-t border-slate-100" data-round={r.hour}
            data-round-state={r.result ? 'measured' : r.due <= now ? 'missing' : 'pending'}>
            <td className="py-1">{Math.round(r.hour * 10) / 10} ชม.{r.followup ? ' · รอบเพิ่ม' : ''}</td>
            <td>{stamp(r.due)}</td>
            <td>{r.result ? stamp(r.result.observed) : '—'}</td>
            <td>{r.result ? r.result.value : r.due <= now ? <span className="text-amber-800">ถึงรอบแล้ว · ยังไม่มีค่า</span> : <span className="text-slate-500">รอวัด</span>}</td>
          </tr>)}
        </tbody>
      </table>

      {signal === 'issue' && row.problem && <div role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
        <p className="flex items-center gap-1.5 font-semibold"><CircleAlert aria-hidden="true" className="size-4" />รอเจ้าของตัดสินใจ</p>
        <p className="mt-1">{row.problem}</p>
        <p className="mt-1 text-xs">ตัวเลือก: ติดตามต่อ · เพิ่มรอบ · ยุติพร้อมเหตุผล — ตอบได้ในเครื่องมือใบงานตามเวลาหรือผ่าน LINE</p>
      </div>}
      {row.notes.filter((n) => n.action !== 'issue').length > 0 && <div>
        <h3 className="text-xs font-semibold text-slate-600">คำตัดสิน</h3>
        <ul className="mt-1 space-y-1" data-decisions>
          {row.notes.filter((n) => n.action !== 'issue').map((n) => <li key={n.at} className="rounded-md bg-slate-50 px-2 py-1.5">
            {n.action === 'followup' ? 'เพิ่มรอบ' : n.action === 'continue' ? 'ติดตามต่อ' : 'ยุติ'} · ผ่าน {n.via} · {stamp(n.at)}<span className="block text-xs text-slate-600">{n.note}</span>
          </li>)}
        </ul>
      </div>}
      <p className="text-xs text-slate-500">รายงาน: วัดแล้ว {report.count}/{report.total} รอบ{report.delta !== null ? ` · เปลี่ยนไป ${report.delta} ${row.unit}` : ''}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOpenGraph} className="lab-room-chip"><Network aria-hidden="true" />กราฟการทดลอง</button>
        {cloud}
      </div>
      {fixture && <div className="space-y-1 border-t border-slate-200 pt-2 text-xs">
        <p className="text-slate-500">ทดสอบในเครื่อง: เล่นซ้ำคำตอบ LINE ของตัวอย่าง (ไม่ได้ส่งข้อความ LINE จริง)</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={timed.replayLineReply} className="lab-room-chip" data-testid="timed-line-replay">จำลองคำตอบจาก LINE</button>
          <button type="button" onClick={timed.resetFixture} className="lab-room-chip"><RotateCcw aria-hidden="true" />เริ่มตัวอย่างใหม่</button>
        </div>
        {timed.message && <p role="status" className="text-slate-700" data-timed-message>{timed.message}</p>}
      </div>}
    </section>
  )
}
