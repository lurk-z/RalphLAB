'use client'

import { useState } from 'react'
import { FlaskConical, RotateCcw, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { counts } from '@/lib/lab-demo/events'
import { DEFAULT_SCENARIO, SCENARIOS, type Scenario } from '@/lib/lab-demo/research'
import type { AgentRole } from '@/lib/lab-demo/events'
import type { AgentDemo } from './useAgentDemo'

/**
 * Demo-only entry for the approval-gated research walkthrough. It picks a scenario, sends the
 * D01 brief to the Study Lead through the normal chat, and can reset this project's run.
 * Everything after that happens in the existing chat and room.
 */
export default function ResearchDemoPanel({ demo, onOpenStudyLead, onOpenRequest, onReset }: {
  demo: AgentDemo
  onOpenStudyLead: () => void
  onOpenRequest: (role: AgentRole, threadId: string, messageId: string) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Scenario>(DEFAULT_SCENARIO)
  const scenario = demo.scenario ?? choice
  const tally = counts(demo.state)
  const pending = Object.values(demo.state.research).find((r) => r.status === 'pending')
  const projectSources = Object.values(demo.state.sources).filter((s) => s.origin === 'project').length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="research-demo-entry"
          className="ml-1 flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 font-medium text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100 focus-visible:ring-2 focus-visible:ring-violet-600">
          <Search aria-hidden="true" className="size-3.5" />ทดลองขอค้นหลักฐาน
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} aria-label="รอบทดสอบการขอค้นหลักฐาน" className="z-[90] w-80 bg-white p-3 text-xs text-slate-700">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><FlaskConical aria-hidden="true" className="size-4 text-violet-700" />ทดลองขอค้นหลักฐาน · D01</p>
        <p className="mt-1 text-slate-600">ส่งโจทย์ D01 ให้ Study Lead แล้วติดตามในแชตกับห้อง ผู้ดูแลข้อมูลจะขออนุมัติก่อนค้นเอกสารนอกโครงการ · ข้อมูลจำลอง</p>
        <label className="mt-3 block">
          <span className="font-medium text-slate-800">สถานการณ์ทดสอบ</span>
          <select value={scenario} disabled={Boolean(demo.scenario) || demo.started} onChange={(event) => setChoice(event.target.value as Scenario)}
            data-testid="research-scenario"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-600">
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span className="mt-1 block text-slate-500">{SCENARIOS.find((s) => s.id === scenario)?.hint}</span>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {!demo.started ? <button type="button" disabled={!demo.ready} onClick={() => {
            void demo.startResearchDemo(choice)
            onOpenStudyLead()
            setOpen(false)
          }} className="rounded-lg bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800 disabled:opacity-50">ส่งโจทย์ D01 ให้ Study Lead</button>
            : pending ? <button type="button" onClick={() => { onOpenRequest(pending.by, pending.threadId, pending.messageId); setOpen(false) }}
              className="rounded-lg bg-rose-700 px-3 py-1.5 text-white hover:bg-rose-800">เปิดคำขอที่รอตอบ</button>
            : <button type="button" onClick={() => { onOpenStudyLead(); setOpen(false) }} className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700">เปิดแชต Study Lead</button>}
          <button type="button" data-testid="research-demo-reset" onClick={() => {
            demo.resetRun()
            setChoice(DEFAULT_SCENARIO)
            onReset()
          }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            <RotateCcw aria-hidden="true" className="size-3.5" />เริ่มรอบทดสอบใหม่
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-200 pt-2" data-testid="research-demo-counts"
          data-requests={tally.researchRequests} data-searches={tally.searches} data-adapter-calls={demo.adapterCalls} data-project-sources={projectSources}>
          <dt className="text-slate-500">คำขออนุมัติ</dt><dd>{tally.researchRequests}</dd>
          <dt className="text-slate-500">ค้นเอกสาร (จำลอง)</dt><dd>{tally.searches} ครั้ง</dd>
          <dt className="text-slate-500">แหล่งที่ค้นพบในโครงการ</dt><dd>{projectSources}</dd>
        </dl>
        <p className="mt-2 text-[11px] text-slate-500">เริ่มรอบใหม่ล้างเฉพาะรอบนี้ของโครงการและผู้ใช้นี้</p>
      </PopoverContent>
    </Popover>
  )
}
