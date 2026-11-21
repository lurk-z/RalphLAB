'use client'

import { ExternalLink, MessageCircle, Target, X } from 'lucide-react'
import type { GraphNode, MessageRef } from '@/lib/lab-graph/model'

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  agent: 'Agent', branch: 'สาขา', formula: 'สูตร', evidence: 'หลักฐาน', result: 'ผลคัดกรอง',
  decision: 'ข้อสรุป', query: 'คำค้น', document: 'เอกสารต้นทาง', missing: 'ยังไม่มีข้อมูล',
  source: 'รายละเอียดแหล่งข้อมูล', research: 'คำขอค้นเอกสาร', passage: 'ข้อความหลักฐาน',
}

export default function GraphDetail({ node, isFocus, onClose, onSelect, onFocusAgent, onOpenMessage, onOpenChat }: {
  node: GraphNode
  isFocus: boolean
  onClose?: () => void
  onSelect: (id: string) => void
  onFocusAgent: (node: GraphNode) => void
  onOpenMessage: (ref: MessageRef) => void
  onOpenChat: (node: GraphNode) => void
}) {
  return (
    <section aria-label={`รายละเอียด ${node.label}`} className="lab-graph-detail">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
        <h2 className="text-base font-semibold">{KIND_LABEL[node.kind]}</h2>
        {onClose && <button type="button" onClick={onClose} aria-label="ปิดรายละเอียด" title="ปิดรายละเอียด"
          className="grid size-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-600"><X className="size-5" /></button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <h3 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900">{node.heading}</h3>
        {node.demo && <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">ข้อมูลจำลอง</span>}
        {node.facts.length > 0 && <dl className="mt-4 divide-y divide-slate-200 border-b border-slate-200 text-sm">
          {node.facts.map((fact) => <div key={fact.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-slate-600">{fact.label}</dt>
            <dd className="text-slate-900">{fact.link
              ? <button type="button" onClick={() => onSelect(fact.link!)} className="text-left text-teal-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-teal-600">{fact.value}</button>
              : fact.value}</dd>
          </div>)}
        </dl>}
        {node.summary && !node.facts.some((fact) => fact.value === node.summary) && <p className="mt-4 text-sm leading-6 text-slate-700">{node.summary}</p>}
        {node.lists.map((list) => <div key={list.title} className="mt-5">
          <h4 className="mb-1.5 text-xs font-semibold text-slate-600">{list.title}</h4>
          <ul className="space-y-1 text-sm">
            {list.items.map((item, i) => <li key={i} className="rounded-md bg-slate-50 px-3 py-2">
              {item.link
                ? <button type="button" onClick={() => onSelect(item.link!)} className="text-left font-medium text-teal-800 hover:underline focus-visible:ring-2 focus-visible:ring-teal-600">{item.label}</button>
                : <span className="font-medium text-slate-900">{item.label}</span>}
              {item.note && <span className="mt-0.5 block text-xs leading-5 text-slate-600">{item.note}</span>}
            </li>)}
          </ul>
        </div>)}
        <div className="mt-6 flex flex-wrap gap-2">
          {node.message && <button type="button" onClick={() => onOpenMessage(node.message!)} className="lab-graph-action">
            <ExternalLink aria-hidden="true" />เปิดข้อความต้นทาง</button>}
          {node.kind === 'agent' && !isFocus && <button type="button" onClick={() => onFocusAgent(node)} className="lab-graph-action">
            <Target aria-hidden="true" />โฟกัสที่ Agent นี้</button>}
          {node.kind === 'agent' && <button type="button" onClick={() => onOpenChat(node)} className="lab-graph-action">
            <MessageCircle aria-hidden="true" />เปิดแชต</button>}
        </div>
        {node.eventIds.length > 0 && <p className="mt-5 break-all text-[11px] leading-5 text-slate-500">เหตุการณ์ · {node.eventIds.join(', ')}</p>}
      </div>
    </section>
  )
}
