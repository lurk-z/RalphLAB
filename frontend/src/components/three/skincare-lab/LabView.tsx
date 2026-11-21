'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import SceneBoundary from './SceneBoundary'
import { ChevronDown, FlaskConical, MessageCircle } from 'lucide-react'
import { ROLE_LABEL, roleGuide } from './agents/roles'
import { HANDOFFS, type Progress } from './agents/handoffDemo'
import type { Role } from './agents/workflow'
import LabAgentChat from './chat/LabAgentChat'
import { useLabAgentChat, type ChatFormula } from './chat/useLabAgentChat'
import { useAgentDemo } from './chat/useAgentDemo'
import { chatAgentStatuses, demoAgentStatuses } from '@/lib/lab-demo/agent-status'
import { messageJobId, type DemoScreen } from '@/lib/lab-demo/conversations'
import { groupThreadId } from '@/lib/lab-demo/events'
import ResearchDemoPanel from './chat/ResearchDemoPanel'
import { loadLabScreen, saveLabScreen, saveReadingThread, viewKey } from '@/lib/lab-graph/view-memory'

// WebGL scene — client-only.
const LabRoomCanvas = dynamic(() => import('./LabRoomCanvas'), { ssr: false })

/**
 * The 3D lab and its private and group conversations.
 * `embedded`: fill the nearest positioned parent instead of the whole window (used as a tab inside /assess).
 */
const CHAT_WIDTH_KEY = 'ralphlab:agent-chat:width'
const CHAT_MIN_WIDTH = 290
const CHAT_MAX_WIDTH = 560
const MIN_ROOM_WIDTH = 365

export default function LabView({ embedded = false, projectId = null, formula, onOpenGraph }: {
  embedded?: boolean
  projectId?: number | null
  formula?: ChatFormula
  /** Opens the project graph focused on an agent (Studio only). */
  onOpenGraph?: (agent: Role) => void
} = {}) {
  const memoryKey = viewKey(projectId)
  // Returning from Graph (or opening a message from it) restores this conversation.
  const [restored] = useState(() => loadLabScreen(memoryKey))
  const [ready, setReady] = useState(false)
  const [agent, setAgent] = useState<Role | null>(restored?.agent ?? null)
  const [cameraAgent, setCameraAgent] = useState<Role | null>(null)
  const [chatWidth, setChatWidth] = useState(400)
  const [demoChat, setDemoChat] = useState(false)
  // Normal Lab entry uses the project-scoped handoff chat with simulated agents.
  const [agentDemoOn, setAgentDemoOn] = useState(true)
  const [demoScreen, setDemoScreen] = useState<DemoScreen>(restored?.screen ?? { kind: 'private' })
  const agentDemo = useAgentDemo(projectId)
  const [progress, setProgress] = useState<Progress>()
  const [sampleOpen, setSampleOpen] = useState(0)
  const splitRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const roleSelect = useRef<HTMLSelectElement>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const lastThreads = useRef(new Map<string, string | null>())
  const chatScope = JSON.stringify([projectId, agentDemo.userId, agentDemoOn ? 'demo' : demoChat ? 'scripted' : 'api', agent])
  const chatOpen = agent !== null
  useEffect(() => {
    if (chatOpen) panelRef.current?.focus({ preventScroll: true })
  }, [chatOpen])
  const drag = useRef<{ pointerId: number; x: number; width: number; maxWidth: number; nextWidth: number } | null>(null)
  const resizeFrame = useRef(0)
  const chat = useLabAgentChat(projectId, agentDemo.userId, demoChat, progress)
  const statuses = useMemo(() => agentDemoOn
    ? demoAgentStatuses(agentDemo.state)
    : chatAgentStatuses(chat.threads, chat.pending, chat.activity),
    [agentDemoOn, agentDemo.state, chat.threads, chat.pending, chat.activity])
  const handleReady = useCallback(() => setReady(true), [])
  const demoState = useRef(agentDemo.state)
  demoState.current = agentDemo.state
  const selectAgent = useCallback((role: Role | null, threadId?: string, highlightId?: string) => {
    // A question asked in the project group (e.g. the Curator's search request) opens there.
    const state = demoState.current
    const message = highlightId ? state.messages.find((m) => m.messageId === highlightId) : undefined
    const jobId = message && threadId === groupThreadId(state.projectId) ? messageJobId(state, message) : undefined
    setDemoScreen(jobId ? { kind: 'group', jobId, highlightId } : { kind: 'private', threadId, highlightId })
    setSampleOpen(0)
    setAgent(role)
    setCameraAgent(role)
  }, [])
  const inspectSample = useCallback(() => {
    setAgent('analyst')
    setCameraAgent(null)
    setSampleOpen(value => value + 1)
  }, [])
  const stopFollowing = useCallback(() => setCameraAgent(null), [])
  useEffect(() => saveLabScreen(memoryKey, { agent, screen: demoScreen }), [memoryKey, agent, demoScreen])
  // The run continues where a reload left it, once the user is in the Lab.
  const resumeRun = agentDemo.resume
  const runKey = agentDemo.scopeKey
  const ready_ = agentDemo.ready
  useEffect(() => { if (ready_) resumeRun() }, [runKey, ready_, resumeRun])
  const rememberThread = useCallback((role: Role, threadId: string) => saveReadingThread(memoryKey, role, threadId), [memoryKey])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const scriptedRoom = params.get('demoChat') === '1'
    setDemoChat(scriptedRoom)
    setAgentDemoOn(params.has('agentDemo') ? params.get('agentDemo') === '1' : !scriptedRoom)
    try {
      const value = Number(window.localStorage.getItem(CHAT_WIDTH_KEY))
      if (value >= CHAT_MIN_WIDTH && value <= CHAT_MAX_WIDTH) setChatWidth(value)
    } catch { /* Browser storage may be disabled. */ }
    return () => window.cancelAnimationFrame(resizeFrame.current)
  }, [])

  function maxChatWidth() {
    const splitWidth = splitRef.current?.clientWidth ?? CHAT_MAX_WIDTH + MIN_ROOM_WIDTH
    return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, splitWidth - MIN_ROOM_WIDTH))
  }

  function chooseChatMode(mode: 'demo' | 'api') {
    const demo = mode === 'demo'
    setAgentDemoOn(demo)
    setDemoChat(false)
    setDemoScreen({ kind: 'private' })
    const url = new URL(window.location.href)
    url.searchParams.delete('demoChat')
    url.searchParams.set('agentDemo', demo ? '1' : '0')
    window.history.replaceState(window.history.state, '', url)
  }

  function commitWidth(width: number) {
    panelRef.current?.style.setProperty('--chat-width', `${width}px`)
    setChatWidth(width)
    try { window.localStorage.setItem(CHAT_WIDTH_KEY, String(width)) } catch { /* Browser storage may be disabled. */ }
  }

  function moveDivider(pointerId: number, x: number) {
    const current = drag.current
    if (!current || current.pointerId !== pointerId) return
    const width = Math.round(Math.max(CHAT_MIN_WIDTH, Math.min(current.maxWidth, current.width + current.x - x)))
    if (width === current.nextWidth) return
    current.nextWidth = width
    // Update the pane boundary once per paint, then commit React state at the end.
    if (resizeFrame.current) return
    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = 0
      panelRef.current?.style.setProperty('--chat-width', `${current.nextWidth}px`)
    })
  }

  function finishDrag(pointerId: number) {
    const current = drag.current
    if (!current || current.pointerId !== pointerId) return
    window.cancelAnimationFrame(resizeFrame.current)
    resizeFrame.current = 0
    drag.current = null
    commitWidth(current.nextWidth)
  }

  function rolePicker(inControls: boolean) {
    return <div className="relative min-w-0 flex-1">
      <select ref={inControls ? roleSelect : undefined} aria-label="เลือกงานและผู้เชี่ยวชาญ" value={agentDemoOn && demoScreen.kind !== 'private' ? '' : agent ?? ''} onChange={event => selectAgent(event.target.value as Role)}
        className="h-11 w-full appearance-none truncate rounded-xl bg-teal-800 pl-3 pr-9 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:ring-2 focus-visible:ring-teal-600">
        <option disabled value="">เลือกงานและผู้เชี่ยวชาญ</option>
        {(Object.keys(ROLE_LABEL) as Role[]).map(role => <option key={role} value={role}>{roleGuide[role].task} · {ROLE_LABEL[role]}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-white" />
    </div>
  }

  return (
    <main className={`${embedded ? 'absolute' : 'fixed'} lab-chat-workspace inset-0 overflow-hidden bg-[#c9d5df] text-slate-800`}>
      <div ref={splitRef} className="lab-chat-split" data-chat-open={chatOpen}>
        <div className="lab-room-pane flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 select-none overflow-hidden">
            <div className="lab-room-viewport">
            <SceneBoundary rolePicker={rolePicker(false)}><LabRoomCanvas statuses={statuses} onReady={handleReady} chatOpen={agent !== null} cameraAgent={cameraAgent} onAgentSelect={selectAgent} onStopFollowing={stopFollowing} onHandoff={demoChat ? setProgress : undefined} onSample={demoChat ? inspectSample : undefined} />
              {!ready && <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-[#c9d5df] text-sm text-slate-500">กำลังโหลดห้องแล็บ</div>}
            </SceneBoundary>
          </div>
          {demoChat && progress && (
            <button type="button" onClick={() => selectAgent(HANDOFFS[progress.index].from)} className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded-xl bg-white/95 px-3 py-2 text-left text-xs shadow-sm">
              <span className="block text-teal-700">โครงการจำลอง D01 · {progress.index + 1}/{HANDOFFS.length}</span>
              {HANDOFFS[progress.index].title} · {progress.delivered ? 'ส่งถึงแล้ว' : 'กำลังส่ง'}
            </button>
          )}
          {cameraAgent && <button type="button" onClick={stopFollowing} className="absolute right-3 top-3 z-20 rounded-full border bg-white px-3 py-2 text-xs text-slate-700">ดูทั้งห้อง</button>}
          </div>
          <div className="lab-room-controls">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800"><FlaskConical aria-hidden="true" className="size-5" /></span>
              <div><h1 className="text-base font-semibold text-slate-900">ห้องแล็บ 3D</h1>
                <p className="text-xs leading-5 text-slate-600">เลือกผู้เชี่ยวชาญหรือแตะตัวละครเพื่อเริ่มคุย</p></div>
            </div>
            <div className="lab-room-actions">
              <details className="relative shrink-0">
                <summary className="cursor-pointer rounded-xl border bg-white px-3 py-2 text-sm">ใบงานและโต๊ะทดลอง</summary>
                <nav aria-label="ใบงานและโต๊ะทดลอง" className="absolute bottom-full z-30 mb-2 grid w-max gap-2 rounded-xl border bg-white p-3 text-sm shadow">
                  <a href="/lab-room/orders">ใบงาน Agent</a>
                  <a href="/lab-room?table=station">สถานีทดสอบสูตร</a>
                  <a href="/lab-room?table=protein">งานโปรตีนบนโต๊ะ 3D</a>
                  <a href="https://ralphlab-workbench.surawit2003it.chatgpt.site/lab-room/timed">ติดตามตามเวลา</a>
                  <a href="https://ralphlab-workbench.surawit2003it.chatgpt.site/lab-room/team">ทีม Agent</a>
                </nav>
              </details>
              {rolePicker(true)}
              {agentDemoOn && <button type="button" className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-teal-600" onClick={() => {
                setAgent((value) => value ?? 'director')
                setCameraAgent(null)
                setDemoScreen({ kind: 'inbox' })
              }}><MessageCircle aria-hidden="true" className="size-4 text-teal-800" />รายการแชต</button>}
              {agentDemoOn && <ResearchDemoPanel demo={agentDemo}
                onOpenStudyLead={() => selectAgent('director')}
                onOpenRequest={(role, threadId, messageId) => selectAgent(role, threadId, messageId)}
                onReset={() => selectAgent(null)} />}
            </div>
          </div>
        </div>
        {agent && (
          <div ref={panelRef} tabIndex={-1} aria-label="แชตในห้องแล็บ" role="region" className="lab-chat-panel" style={{ '--chat-width': `${chatWidth}px` } as CSSProperties}>
            <div
              className="lab-chat-divider"
              role="separator"
              tabIndex={0}
              aria-label="ปรับความกว้างแชต"
              aria-orientation="vertical"
              aria-valuemin={CHAT_MIN_WIDTH}
              aria-valuemax={CHAT_MAX_WIDTH}
              aria-valuenow={chatWidth}
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return
                const width = panelRef.current?.clientWidth ?? chatWidth
                drag.current = { pointerId: event.pointerId, x: event.clientX, width, maxWidth: maxChatWidth(), nextWidth: width }
                stopFollowing()
                event.currentTarget.setPointerCapture(event.pointerId)
                event.preventDefault()
              }}
              onPointerMove={(event) => moveDivider(event.pointerId, event.clientX)}
              onPointerUp={(event) => {
                moveDivider(event.pointerId, event.clientX)
                finishDrag(event.pointerId)
              }}
              onPointerCancel={(event) => finishDrag(event.pointerId)}
              onLostPointerCapture={(event) => finishDrag(event.pointerId)}
              onKeyDown={(event) => {
                const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
                if (!direction || drag.current) return
                event.preventDefault()
                const width = panelRef.current?.clientWidth ?? chatWidth
                stopFollowing()
                commitWidth(Math.max(CHAT_MIN_WIDTH, Math.min(maxChatWidth(), width + direction * 24)))
              }}
            />
            <LabAgentChat key={JSON.stringify([chatScope, demoScreen.kind, demoScreen.kind === 'group' ? demoScreen.jobId : demoScreen.kind === 'private' ? demoScreen.threadId : null])}
              chatScope={chatScope} drafts={drafts} setDrafts={setDrafts} lastThreads={lastThreads.current}
              agent={agent} formula={demoChat || agentDemoOn ? undefined : formula} chat={chat} onSelectAgent={selectAgent} onClose={() => {
                selectAgent(null)
                requestAnimationFrame(() => roleSelect.current?.focus({ preventScroll: true }))
              }} progress={demoChat ? progress : undefined}
              onModeChange={chooseChatMode}
              sampleOpen={sampleOpen} agentDemo={agentDemoOn ? agentDemo : undefined} screen={demoScreen} navigate={setDemoScreen}
              onOpenGraph={onOpenGraph} onReadingThread={rememberThread} />
          </div>
        )}
      </div>
    </main>
  )
}
