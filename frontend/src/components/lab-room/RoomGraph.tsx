'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { ApiError, http } from '@/lib/api'
import { buildProjectGraph, type MessageRef, type ProjectGraph } from '@/lib/lab-graph/model'
import { buildCaseGraph, hasRecords, type LiveCase } from '@/lib/lab-graph/live'
import { buildTimedGraph } from '@/lib/lab-graph/timed-graph'
import type { AgentRole } from '@/lib/lab-demo/events'
import { contextKey, contextLabel, DEMO_STUDY, TIMED_FIXTURE, type RoomContext } from '@/lib/lab-room/route'
import type { AgentDemo } from '@/components/three/skincare-lab/chat/useAgentDemo'
import type { useTimedStudy } from './useTimedStudy'
import '@/components/lab-graph/graph.css'

const ProjectGraphView = dynamic(() => import('@/components/lab-graph/ProjectGraphView'), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full place-items-center text-sm text-slate-500">กำลังโหลดกราฟ…</div>,
})

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'forbidden' | 'unavailable'; message: string }

/** Read-only GET of the context's records. Never posts, seeds or approves anything. */
function useRecords<T>(path: string | null) {
  const [state, setState] = useState<Load<T>>({ status: 'loading' })
  useEffect(() => {
    if (!path) return
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    http<T>(path, { signal: ctrl.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error) => {
        if (ctrl.signal.aborted) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
          setState({ status: 'forbidden', message: error.status === 401 ? 'ต้องเข้าสู่ระบบก่อนเปิดงานนี้' : 'ไม่พบงานนี้ หรือบัญชีนี้ไม่มีสิทธิ์อ่าน' })
        } else setState({ status: 'unavailable', message: 'เชื่อมต่อบริการใบงานไม่ได้ในตอนนี้' })
      })
    return () => ctrl.abort()
  }, [path])
  return state
}

/** A full-page explanation instead of a graph: nothing selected, no records, no access, service down. */
function GraphState({ title, children, onBack, kind }: { title: string; children: ReactNode; onBack: () => void; kind: string }) {
  return <div className="lab-graph-shell grid h-full place-items-center bg-background p-6" data-graph-state={kind}>
    <div className="w-full max-w-lg rounded-xl border bg-white p-5 text-sm text-slate-700 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
      <button type="button" onClick={onBack} className="lab-graph-action mt-4"><ArrowLeft aria-hidden="true" />กลับห้องแล็บ</button>
    </div>
  </div>
}

export default function RoomGraph({ context, viewer, demo, timed, requestedAgent, onAgentChange, onOpenLab, onBack, onChooseContext }: {
  context: RoomContext
  viewer: string
  demo: AgentDemo
  timed: ReturnType<typeof useTimedStudy> | null
  requestedAgent: AgentRole | null
  onAgentChange: (role: AgentRole) => void
  onOpenLab: (target: { message?: MessageRef; agent?: AgentRole }) => void
  onBack: () => void
  /** Pick a work context from an empty state (keeps the graph view). */
  onChooseContext: (href: string) => void
}) {
  const orderPath = context.kind === 'order' ? `/api/lab/projects/${context.projectId}/orders/${context.orderId}` : null
  const listPath = context.kind === 'project' ? `/api/lab/projects/${context.projectId}/orders` : null
  const order = useRecords<LiveCase>(orderPath)
  const list = useRecords<LiveCase[]>(listPath)
  const [recording, setRecording] = useState(false)

  const demoGraph = useMemo(() => context.kind === 'demo' ? buildProjectGraph(demo.state) : null, [context.kind, demo.state])
  const liveGraph = useMemo(() => order.status === 'ready' ? buildCaseGraph(order.data) : null, [order])
  const timedGraph = useMemo(() => timed?.row ? buildTimedGraph(timed.row, context.kind === 'timed' && context.fixture, Date.now()) : null, [timed?.row, context])
  const memoryKey = 'graph|' + contextKey(viewer, context)
  const common = { memoryKey, requestedAgent, onAgentChange, onOpenLab, onBack, title: contextLabel(context) }

  switch (context.kind) {
    case 'none':
      return <GraphState kind="no-selection" title="ยังไม่ได้เลือกงาน" onBack={onBack}>
        <p>กราฟแสดงหลักฐานของงานที่เลือกเท่านั้น เลือกงานก่อน:</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="lab-graph-action" onClick={() => onChooseContext(`/lab-room?view=graph&demo=${DEMO_STUDY}`)}>ตัวอย่าง D01 · ข้อมูลจำลอง</button>
          <button type="button" className="lab-graph-action" onClick={() => onChooseContext(`/lab-room?view=graph&study=${TIMED_FIXTURE}`)}>ใบงานตามเวลา · ข้อมูลจำลอง</button>
          <a className="lab-graph-action" href="/lab-room/orders">เลือกโครงการและใบงาน</a>
        </div>
      </GraphState>
    case 'invalid':
      return <GraphState kind="invalid" title="เปิดงานนี้ไม่ได้" onBack={onBack}>
        <p>รหัส <code className="rounded bg-slate-100 px-1">{context.param}={context.value || '(ว่าง)'}</code> ไม่ถูกต้อง ระบบจะไม่เปิดงานอื่นแทน</p>
      </GraphState>
    case 'demo': {
      const graph = demoGraph!
      const empty = !Object.keys(demo.state.sources).length && !Object.keys(demo.state.facts).length && !graph.recordedHandoffs
      return <ProjectGraphView key={memoryKey} graph={graph} demo {...common} notice={empty && <>
        <p className="font-semibold text-slate-900">ยังไม่มีเหตุการณ์ของ {DEMO_STUDY}</p>
        <p className="mt-1 text-slate-600">เริ่มจาก “ทดลองขอค้นหลักฐาน” ในห้อง หรือบันทึกบทเดโมทั้งรอบ · การเปิดกราฟเองไม่เริ่มงานใด ๆ</p>
        <button type="button" disabled={recording} className="lab-graph-action mt-3 bg-teal-700 text-white hover:bg-teal-800"
          onClick={async () => { setRecording(true); try { await demo.recordStudy() } finally { setRecording(false) } }}>
          {recording && <LoaderCircle aria-hidden="true" className="animate-spin" />}บันทึกบทเดโม {DEMO_STUDY} · ข้อมูลจำลอง
        </button>
      </>} />
    }
    case 'project': {
      if (list.status === 'loading') return <GraphState kind="loading" title="กำลังโหลดใบงาน…" onBack={onBack}><p>อ่านรายการใบงานของโครงการ #{context.projectId}</p></GraphState>
      if (list.status !== 'ready') return <GraphState kind={list.status} title={list.status === 'forbidden' ? 'ไม่มีสิทธิ์เปิดโครงการนี้' : 'บริการใบงานไม่พร้อม'} onBack={onBack}><p>{list.message}</p></GraphState>
      return <GraphState kind={list.data.length ? 'choose-order' : 'empty'} title={`เลือกใบงานของโครงการ #${context.projectId}`} onBack={onBack}>
        {list.data.length ? <ul className="space-y-1.5">
          {list.data.map((c) => <li key={c.id}><button type="button" className="w-full rounded-lg border px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => onChooseContext(`/lab-room?view=graph&project=${context.projectId}&order=${c.id}`)}>
            <span className="block font-medium text-slate-900">{c.request.brief}</span><span className="text-xs text-slate-500">{c.state} · {c.id.slice(0, 8)}</span>
          </button></li>)}
        </ul> : <p>โครงการนี้ยังไม่มีใบงาน จึงยังไม่มีหลักฐานให้แสดง</p>}
        <button type="button" className="lab-graph-action" onClick={() => onChooseContext(`/lab-room?view=graph&demo=${DEMO_STUDY}&projectId=${context.projectId}`)}>หรือเปิดตัวอย่าง D01 · ข้อมูลจำลอง</button>
      </GraphState>
    }
    case 'order': {
      if (order.status === 'loading') return <GraphState kind="loading" title="กำลังโหลดใบงาน…" onBack={onBack}><p>อ่านบันทึกของใบงาน {context.orderId.slice(0, 8)}</p></GraphState>
      if (order.status !== 'ready') return <GraphState kind={order.status} title={order.status === 'forbidden' ? 'ไม่มีสิทธิ์เปิดใบงานนี้' : 'บริการใบงานไม่พร้อม'} onBack={onBack}><p>{order.message}</p></GraphState>
      const graph = liveGraph!
      return <ProjectGraphView key={memoryKey} graph={graph} demo={false} {...common} notice={!hasRecords(graph) && <>
        <p className="font-semibold text-slate-900">ใบงานนี้ยังไม่มีหลักฐานหรือคำตัดสิน</p>
        <p className="mt-1 text-slate-600">ยังไม่มีแหล่งอ้างอิง ผลรายขั้น หรือคำตัดสินที่บันทึกไว้ เมื่อ Agent หรือเจ้าของบันทึกแล้วจะแสดงที่นี่</p>
      </>} />
    }
    case 'timed': {
      if (!timedGraph) return <GraphState kind={context.fixture ? 'loading' : 'unavailable'} title={context.fixture ? 'กำลังเปิดตัวอย่าง…' : 'ใบงานตามเวลาอยู่บน Cloud'} onBack={onBack}>
        <p>{context.fixture ? '' : 'แอปนี้ยังอ่านใบงานตามเวลาจาก Cloud โดยตรงไม่ได้ (Cloud ใช้บัญชีของเว็บ Cloud) · เปิดใน Cloud เพื่อดูข้อมูลจริง'}</p>
      </GraphState>
      return <ProjectGraphView key={memoryKey} graph={timedGraph} demo={context.fixture} {...common} />
    }
  }
}
