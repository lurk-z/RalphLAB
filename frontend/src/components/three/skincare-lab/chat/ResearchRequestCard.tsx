'use client'

import { useState } from 'react'
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, Pencil, RotateCw, Search, ShieldCheck } from 'lucide-react'
import { ROLE_EN } from '@/lib/lab-demo/roles'
import { currentScope, type ResearchRequest } from '@/lib/lab-demo/events'
import { ENDPOINT_TH } from '@/lib/lab-demo/research'
import type { AgentDemo } from './useAgentDemo'

const MAX_QUERY = 120

/**
 * The Curator's request to search outside the project. The owner sees exactly what would be
 * sent and for which project, formula version and limit, and answers once: approve, edit the
 * draft (still needs approval), or continue with the data already in the project.
 */
export default function ResearchRequestCard({ demo, request }: { demo: AgentDemo; request: ResearchRequest }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(request.query)
  const [sending, setSending] = useState(false)
  const state = demo.state
  const shown = currentScope(state.projectId, request)
  const owner = demo.approver
  const endpoint = ENDPOINT_TH[request.question.endpoint]
  const facts = Object.values(state.facts)
  const resultIds = request.searches.at(-1)?.resultIds ?? []
  const insufficient = facts.some((f) => f.kind === 'insufficient' && f.versionId === request.question.versionId && f.endpoint === request.question.endpoint)
  const draftQuery = draft.replace(/\s+/g, ' ').trim()

  function answer(kind: 'approve' | 'use-existing') {
    if (sending) return
    setSending(true)
    // Bound to the scope this card shows; a changed draft must be approved again.
    const accepted = kind === 'approve' ? demo.approveResearch(request.requestId, shown) : demo.useExistingData(request.requestId, shown)
    if (!accepted) setSending(false)
  }

  return (
    <section aria-label="คำขอค้นเอกสารนอกโครงการ" data-request-id={request.requestId} data-request-status={request.status}
      className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm">
      <header className="flex flex-wrap items-center gap-2">
        <Search aria-hidden="true" className="size-4 text-violet-700" />
        <h4 className="text-sm font-semibold text-slate-900">ขอค้นเอกสารนอกโครงการ</h4>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">ข้อมูลจำลอง</span>
      </header>
      <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-slate-500">โครงการ</dt><dd>{request.experimentId} · {state.projectId === 'standalone' ? 'พรีวิวในเครื่อง' : state.projectId}</dd>
        <dt className="text-slate-500">สูตร</dt><dd>{request.question.versionId}</dd>
        <dt className="text-slate-500">คำถาม</dt><dd>{request.question.ingredient} · {endpoint}</dd>
        <dt className="text-slate-500">ขอบเขต</dt><dd>เอกสารสาธารณะไม่เกิน {request.limit} ฉบับ · ครั้งเดียว</dd>
        <dt className="text-slate-500">ตรวจในโครงการแล้ว</dt><dd>{request.checked.join(', ') || '—'}</dd>
        <dt className="text-slate-500">คำค้นที่จะส่ง</dt>
        <dd><code className="break-words rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-900" data-outbound-query>{request.query}</code></dd>
      </dl>

      {request.status === 'pending' && (editing ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => {
          event.preventDefault()
          if (!draftQuery) return
          demo.editResearchQuery(request.requestId, draftQuery)
          setEditing(false)
        }}>
          <label className="block">
            <span className="text-slate-600">แก้คำค้น (ระบุเฉพาะสารและประเด็นที่จำเป็น)</span>
            <input value={draft} maxLength={MAX_QUERY} onChange={(event) => setDraft(event.target.value)} autoFocus
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" />
          </label>
          <p className="text-slate-600">จะส่งเฉพาะข้อความนี้ หลังคุณกดอนุมัติ: <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-900" data-preview-query>{draftQuery || '—'}</code></p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!draftQuery} className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700 disabled:opacity-40">บันทึกคำค้น</button>
            <button type="button" onClick={() => { setDraft(request.query); setEditing(false) }} className="rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100">ยกเลิก</button>
          </div>
        </form>
      ) : owner.owner ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={sending} onClick={() => answer('approve')}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
            <ShieldCheck aria-hidden="true" className="size-3.5" />อนุมัติให้ค้น
          </button>
          <button type="button" disabled={sending} onClick={() => { setDraft(request.query); setEditing(true) }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50 disabled:opacity-50">
            <Pencil aria-hidden="true" className="size-3.5" />แก้คำค้น
          </button>
          <button type="button" disabled={sending} onClick={() => answer('use-existing')}
            className="rounded-lg px-2 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50">ใช้ข้อมูลที่มี</button>
          <span className="basis-full text-[11px] text-slate-500">ผู้อนุมัติ: {owner.label}{owner.simulated ? ' (จำลอง)' : ''} · อนุมัติได้เฉพาะเจ้าของโครงการ</span>
        </div>
      ) : <p className="mt-3 text-slate-600">รอเจ้าของโครงการตัดสินใจ · คุณไม่มีสิทธิ์อนุมัติ</p>)}

      {request.decision && (
        <p className="mt-3 flex items-start gap-1.5 text-slate-800" data-decision={request.decision.decision}>
          <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-teal-700" />
          {request.decision.decision === 'approve' ? 'อนุมัติให้ค้นแล้ว' : 'เลือกใช้ข้อมูลที่มี · ไม่ค้นเพิ่ม'} โดย {request.decision.approver.label}
          {request.decision.approver.simulated ? ' (จำลอง)' : ''}
        </p>
      )}
      {request.status === 'searching' && <p role="status" className="mt-1 flex items-center gap-1.5 text-sky-800">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />กำลังค้นเอกสาร · ครั้งที่ {request.attempts}</p>}
      {request.status === 'failed' && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 text-rose-800">
        <CircleAlert aria-hidden="true" className="size-3.5" />ค้นไม่สำเร็จ · ลองใหม่ (เชื่อมต่อแหล่งค้นไม่ได้ ไม่ใช่ผลทางวิทยาศาสตร์)
        {owner.owner && <button type="button" onClick={() => demo.retryResearch(request.requestId)}
          className="inline-flex items-center gap-1 rounded-full bg-rose-700 px-2.5 py-1 text-white hover:bg-rose-800">
          <RotateCw aria-hidden="true" className="size-3" />ลองใหม่ด้วยขอบเขตเดิม</button>}
      </div>}
      {request.status === 'completed' && <p className="mt-1 text-slate-800" data-result-count={resultIds.length}>
        {resultIds.length ? `พบเอกสาร ${resultIds.length} ฉบับ` : 'ค้นแล้วไม่พบเอกสารที่ใช้ได้'}</p>}

      {resultIds.length > 0 && <ul className="mt-2 space-y-1.5">
        {resultIds.map((id) => {
          const source = state.sources[id]
          const passage = facts.find((f) => f.kind === 'passage' && f.sourceId === id)
          const excluded = facts.find((f) => f.kind === 'excluded' && f.sourceId === id && f.requestId === request.requestId)
          const used = facts.find((f) => f.kind === 'used' && f.sourceId === id && f.versionId === request.question.versionId)
          return <li key={id} data-source-id={id} className="rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="flex items-center gap-1.5 font-medium text-slate-900">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-violet-600" />{id} · {source?.title}
              {used ? <span className="ml-auto text-teal-800">ใช้กับ {request.question.versionId}</span>
                : excluded ? <span className="ml-auto inline-flex items-center gap-0.5 text-slate-600"><CircleX aria-hidden="true" className="size-3" />ไม่ใช้กับคำถามนี้</span>
                : passage ? <span className="ml-auto text-slate-600">รอตรวจโดย {ROLE_EN.analyst}</span> : null}
            </p>
            {excluded && excluded.kind === 'excluded' && <p className="mt-0.5 text-slate-600">{excluded.reason}</p>}
            {passage && passage.kind === 'passage' && <details className="mt-0.5">
              <summary className="cursor-pointer text-teal-800">ข้อความที่บันทึก · ข้อมูลจำลอง</summary>
              <blockquote className="mt-1 border-l-2 border-violet-300 pl-2 text-slate-700">{passage.passage}</blockquote>
            </details>}
          </li>
        })}
      </ul>}
      {request.status !== 'pending' && insufficient && <p className="mt-2 font-semibold text-amber-800" data-insufficient>
        {endpoint}ของ {request.question.versionId}: ข้อมูลไม่พอ</p>}
      <p className="mt-2 text-[11px] text-slate-500">ค้นในรอบนี้ {request.attempts} ครั้ง · ใช้ตัวค้นจำลอง ไม่เชื่อมต่อเครือข่าย</p>
    </section>
  )
}
