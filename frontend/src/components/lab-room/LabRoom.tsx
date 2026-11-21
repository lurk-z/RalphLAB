'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ChevronDown, FlaskConical, MessageCircle, Network, Wrench } from 'lucide-react'
import SceneBoundary from '@/components/three/skincare-lab/SceneBoundary'
import StationPanel from '@/components/three/skincare-lab/station/StationPanel'
import { createStationBridge } from '@/components/three/skincare-lab/station/bridge'
import { ROLE_LABEL, WORKBENCH_ROLE_LABEL, roleGuide } from '@/components/three/skincare-lab/agents/roles'
import { HANDOFFS, type Progress } from '@/components/three/skincare-lab/agents/handoffDemo'
import type { Role } from '@/components/three/skincare-lab/agents/workflow'
import LabAgentChat from '@/components/three/skincare-lab/chat/LabAgentChat'
import { useLabAgentChat } from '@/components/three/skincare-lab/chat/useLabAgentChat'
import { useAgentDemo } from '@/components/three/skincare-lab/chat/useAgentDemo'
import ResearchDemoPanel from '@/components/three/skincare-lab/chat/ResearchDemoPanel'
import { DeskLauncher, ProteinDeskPanel } from '@/components/three/skincare-lab/proteinDesk/ProteinDeskPanel'
import DeskAgentActivity from '@/components/three/skincare-lab/proteinDesk/DeskAgentActivity'
import { useProteinDesk } from '@/components/three/skincare-lab/proteinDesk/useProteinDesk'
import { chatAgentStatuses, demoAgentStatuses } from '@/lib/lab-demo/agent-status'
import { messageJobId, type DemoScreen } from '@/lib/lab-demo/conversations'
import { groupThreadId } from '@/lib/lab-demo/events'
import type { MessageRef } from '@/lib/lab-graph/model'
import { loadLabScreen, openLabAtMessage, saveLabScreen, saveReadingThread } from '@/lib/lab-graph/view-memory'
import {
  contextKey, contextLabel, DEMO_STUDY, parseRoomQuery, roomHref, TIMED_FIXTURE, withView,
  type RoomState, type RoomView,
} from '@/lib/lab-room/route'
import RoomGraph from './RoomGraph'
import TimedStudySummary from './TimedStudySummary'
import { useTimedStudy } from './useTimedStudy'

// WebGL scene — client-only.
const LabRoomCanvas = dynamic(() => import('@/components/three/skincare-lab/LabRoomCanvas'), { ssr: false })

const CHAT_WIDTH_KEY = 'ralphlab:agent-chat:width'
const CHAT_MIN_WIDTH = 290
const CHAT_MAX_WIDTH = 560
const MIN_ROOM_WIDTH = 365

/**
 * `/lab-room` · the one mounted room. It owns the workbench scene, the agent and thread on
 * screen, the selected sample, the camera and the chat, and switches between the room, the
 * full-width graph and the lab tools without remounting any of them. The URL holds the view
 * and the work context, so Back, reload and a login callback return to the same place.
 */
export default function LabRoom({ initial, viewer, localPreview, deskSignedIn, deskLocalLogin }: {
  initial: RoomState
  /** Signed-in viewer (or `guest`): with the context, the key of every read and memory. */
  viewer: string
  localPreview: boolean
  deskSignedIn: boolean
  deskLocalLogin: boolean
}) {
  const [room, setRoom] = useState(initial)
  const context = room.context
  const memoryKey = contextKey(viewer, context)
  const projectId = context.kind === 'demo' ? context.projectId
    : context.kind === 'project' || context.kind === 'order' ? context.projectId : null
  const desk = context.kind === 'order' ? { project: context.projectId, order: context.orderId } : null
  const deskLauncher = room.tool === 'protein' && !desk
  const atDesk = Boolean(desk || deskLauncher)
  const protein = useProteinDesk(desk, deskSignedIn)
  const deskStudy = desk && deskSignedIn ? protein.state.study : null
  const timed = useTimedStudy(context.kind === 'timed' ? context.studyId : TIMED_FIXTURE, context.kind === 'timed' && context.fixture, viewer)

  // ---- one owner for navigation ----------------------------------------------------------
  /** Same context: switch view in place (history entry). Another context: load it afresh. */
  const go = useCallback((next: RoomState, replace = false) => {
    const href = roomHref(next)
    if (contextKey(viewer, next.context) !== contextKey(viewer, room.context)) {
      window.location.assign(href)
      return
    }
    setRoom(next)
    window.history[replace ? 'replaceState' : 'pushState'](null, '', href)
  }, [room.context, viewer])
  useEffect(() => {
    const onPop = () => {
      const parsed = parseRoomQuery(Object.fromEntries(new URLSearchParams(window.location.search)))
      if (!parsed.state || contextKey(viewer, parsed.state.context) !== contextKey(viewer, room.context)) window.location.reload()
      else setRoom(parsed.state)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [room.context, viewer])
  const goToHref = useCallback((href: string) => window.location.assign(href), [])
  const setView = (view: RoomView, agent = room.agent) => go(withView(room, view, agent))

  // ---- chat, agents and camera (one owner) -------------------------------------------------
  const [restored] = useState(() => loadLabScreen(memoryKey))
  const [ready, setReady] = useState(false)
  const [agent, setAgent] = useState<Role | null>(restored?.agent ?? null)
  const [cameraAgent, setCameraAgent] = useState<Role | null>(null)
  const [chatWidth, setChatWidth] = useState(400)
  const [demoChat, setDemoChat] = useState(false)
  // The D01 handoff simulation runs only when D01 is the selected work context.
  const [agentDemoOn, setAgentDemoOn] = useState(context.kind === 'demo')
  const [demoScreen, setDemoScreen] = useState<DemoScreen>(restored?.screen ?? { kind: 'private' })
  const agentDemo = useAgentDemo(projectId)
  const [progress, setProgress] = useState<Progress>()
  const [sampleOpen, setSampleOpen] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const lastThreads = useRef(new Map<string, string | null>())
  const splitRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const roleSelect = useRef<HTMLSelectElement>(null)
  const drag = useRef<{ pointerId: number; x: number; width: number; maxWidth: number; nextWidth: number } | null>(null)
  const resizeFrame = useRef(0)
  const chatScope = JSON.stringify([memoryKey, agentDemo.userId, agentDemoOn ? 'demo' : demoChat ? 'scripted' : 'api', agent])
  const chat = useLabAgentChat(projectId, agentDemo.userId, demoChat, progress)
  const statuses = useMemo(() => agentDemoOn
    ? demoAgentStatuses(agentDemo.state)
    : chatAgentStatuses(chat.threads, chat.pending, chat.activity),
    [agentDemoOn, agentDemo.state, chat.threads, chat.pending, chat.activity])
  const [bridge] = useState(createStationBridge)
  const chatOpen = agent !== null
  const graphOpen = room.view === 'graph'

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
    setSampleOpen((value) => value + 1)
  }, [])
  const stopFollowing = useCallback(() => setCameraAgent(null), [])
  const handleReady = useCallback(() => setReady(true), [])
  useEffect(() => saveLabScreen(memoryKey, { agent, screen: demoScreen }), [memoryKey, agent, demoScreen])
  const rememberThread = useCallback((role: Role, threadId: string) => saveReadingThread(memoryKey, role, threadId), [memoryKey])
  // A reload continues the D01 run where it stopped (never an approval).
  const resumeRun = agentDemo.resume
  const demoReady = agentDemo.ready
  useEffect(() => { if (agentDemoOn && demoReady) resumeRun() }, [agentDemoOn, demoReady, resumeRun, agentDemo.scopeKey])
  useEffect(() => { if (chatOpen) panelRef.current?.focus({ preventScroll: true }) }, [chatOpen])
  // Under the full-width graph the room is neither focusable nor read out, but stays mounted.
  useEffect(() => { splitRef.current?.toggleAttribute('inert', graphOpen) }, [graphOpen])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const scripted = params.get('demoChat') === '1'
    setDemoChat(scripted)
    if (params.has('agentDemo')) setAgentDemoOn(params.get('agentDemo') === '1')
    try {
      const value = Number(window.localStorage.getItem(CHAT_WIDTH_KEY))
      if (value >= CHAT_MIN_WIDTH && value <= CHAT_MAX_WIDTH) setChatWidth(value)
    } catch { /* Browser storage may be disabled. */ }
    return () => window.cancelAnimationFrame(resizeFrame.current)
  }, [])

  function chooseChatMode(mode: 'demo' | 'api') {
    // The simulated handoff chat belongs to the D01 study.
    if (mode === 'demo' && context.kind !== 'demo') {
      go({ ...room, view: 'room', context: { kind: 'demo', study: DEMO_STUDY, projectId } })
      return
    }
    setAgentDemoOn(mode === 'demo')
    setDemoChat(false)
    setDemoScreen({ kind: 'private' })
  }

  // ---- graph ↔ room ------------------------------------------------------------------------
  const openGraph = useCallback((role?: Role | null) => go(withView(room, 'graph', role ?? null)), [go, room])
  const openLab = useCallback(({ message, agent: role }: { message?: MessageRef; agent?: Role }) => {
    if (message) {
      openLabAtMessage(memoryKey, message)
      const screen = loadLabScreen(memoryKey)
      if (screen) setDemoScreen(message.group && message.jobId ? { kind: 'group', jobId: message.jobId, highlightId: message.messageId }
        : { kind: 'private', threadId: message.threadId, highlightId: message.messageId })
      setAgent(message.agent)
    } else if (role) selectAgent(role)
    go(withView(room, 'room', message?.agent ?? role ?? room.agent))
  }, [go, memoryKey, room, selectAgent])

  // ---- chat width ----------------------------------------------------------------------------
  function maxChatWidth() {
    const splitWidth = splitRef.current?.clientWidth ?? CHAT_MAX_WIDTH + MIN_ROOM_WIDTH
    return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, splitWidth - MIN_ROOM_WIDTH))
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
      <select ref={inControls ? roleSelect : undefined} aria-label={deskStudy ? 'ดูงานของ Agent' : 'เลือกงานและผู้เชี่ยวชาญ'}
        value={!deskStudy && agentDemoOn && demoScreen.kind !== 'private' ? '' : agent ?? ''} onChange={(event) => selectAgent(event.target.value as Role)}
        className="h-11 w-full appearance-none truncate rounded-xl bg-teal-800 pl-3 pr-9 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:ring-2 focus-visible:ring-teal-600">
        <option disabled value="">{deskStudy ? 'ดูงานของ Agent' : 'เลือกงานและผู้เชี่ยวชาญ'}</option>
        {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>
          {deskStudy ? WORKBENCH_ROLE_LABEL[role] : `${roleGuide[role].task} · ${ROLE_LABEL[role]}`}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-white" />
    </div>
  }

  const headerAction = (view: RoomView, label: string, Icon: typeof Network, onClick: () => void) =>
    <button type="button" onClick={onClick} aria-pressed={room.view === view} data-room-action={view}
      className={`lab-room-action ${room.view === view ? 'is-active' : ''}`}><Icon aria-hidden="true" />{label}</button>

  return (
    <main className="lab-chat-workspace lab-room-shell fixed inset-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#c9d5df] text-slate-800"
      data-room-view={room.view} data-room-context={context.kind}>
      <header className="lab-room-header">
        <a href={projectId ? '/projects' : '/'} className="lab-room-icon" aria-label="กลับหน้าหลัก"><ArrowLeft aria-hidden="true" /></a>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">ห้องแล็บ</p>
          <p className="truncate text-xs text-slate-600" data-room-context-label>{contextLabel(context)}</p>
        </div>
        <nav aria-label="มุมมองห้องแล็บ" className="lab-room-header-actions">
          {headerAction('room', 'แชตกับ Agent', MessageCircle, () => {
            if (room.view !== 'room') setView('room')
            if (deskStudy) { setAgent((value) => value ?? 'director'); return }
            setAgent((value) => value ?? 'director')
            setCameraAgent(null)
            if (agentDemoOn) setDemoScreen({ kind: 'inbox' })
          })}
          {headerAction('graph', 'กราฟการทดลอง', Network, () => openGraph(null))}
          {headerAction('tools', 'เครื่องมือแล็บ', Wrench, () => setView(room.view === 'tools' ? 'room' : 'tools'))}
        </nav>
      </header>

      <div className="relative min-h-0">
        {/* The room stays mounted under the graph and tools: chat drafts, camera and work go on. */}
        <div ref={splitRef} className="lab-chat-split" data-chat-open={chatOpen} aria-hidden={graphOpen || undefined}>
          <div className="lab-room-pane flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 select-none overflow-hidden">
              <div className="lab-room-viewport">
                <SceneBoundary rolePicker={rolePicker(false)}>
                  <LabRoomCanvas workbench statuses={statuses} onReady={handleReady} paused={graphOpen}
                    bridge={localPreview || atDesk ? undefined : bridge}
                    chatOpen={chatOpen} cameraAgent={cameraAgent} onAgentSelect={selectAgent} onStopFollowing={stopFollowing}
                    onHandoff={demoChat && !atDesk ? setProgress : undefined} onSample={demoChat && !atDesk ? inspectSample : undefined}
                    proteinTable={protein.table} insulinComparison={protein.comparisonTable} proteinWork={protein.work} onProteinPhase={protein.phase} />
                  {!ready && <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-[#c9d5df] text-sm text-slate-500">กำลังโหลดห้องแล็บ</div>}
                </SceneBoundary>
              </div>
              {desk && deskSignedIn ? <ProteinDeskPanel binding={desk} desk={protein} />
                : deskLauncher ? <DeskLauncher projectId={projectId} signedIn={deskSignedIn} localLogin={deskLocalLogin} />
                : demoChat && progress ? (
                  <button type="button" onClick={() => selectAgent(HANDOFFS[progress.index].from)} className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded-xl bg-white/95 px-3 py-2 text-left text-xs shadow-sm">
                    <span className="block text-teal-700">โครงการจำลอง D01 · {progress.index + 1}/{HANDOFFS.length}</span>
                    {HANDOFFS[progress.index].title} · {progress.delivered ? 'ส่งถึงแล้ว' : 'กำลังส่ง'}
                  </button>)
                : room.tool === 'station' && !localPreview ? <StationPanel bridge={bridge} /> : null}
              {context.kind === 'timed' && room.view === 'room' && <div className="lab-room-card">
                <TimedStudySummary studyId={context.studyId} fixture={context.fixture} timed={timed} onOpenGraph={() => openGraph(null)} />
              </div>}
              {context.kind === 'invalid' && <div role="alert" className="lab-room-card" data-invalid-context>
                <p className="font-semibold text-slate-900">เปิดงานนี้ไม่ได้</p>
                <p className="mt-1 text-sm text-slate-700">รหัส <code className="rounded bg-slate-100 px-1">{context.param}={context.value || '(ว่าง)'}</code> ไม่ถูกต้องหรือไม่มีสิทธิ์ ระบบจะไม่เปิดงานอื่นแทน</p>
                <a href="/lab-room" className="lab-room-chip mt-3">กลับห้องแล็บ</a>
              </div>}
              {cameraAgent && <button type="button" onClick={stopFollowing} className="absolute right-3 top-3 z-20 rounded-full border bg-white px-3 py-2 text-xs text-slate-700">ดูทั้งห้อง</button>}
            </div>
            <div className="lab-room-controls">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800"><FlaskConical aria-hidden="true" className="size-5" /></span>
                <p className="text-xs leading-5 text-slate-600">เลือกผู้เชี่ยวชาญหรือแตะตัวละครเพื่อเริ่มคุย</p>
              </div>
              <div className="lab-room-actions">
                {rolePicker(true)}
                {agentDemoOn && !deskStudy && <button type="button" className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-teal-600" onClick={() => {
                  setAgent((value) => value ?? 'director')
                  setCameraAgent(null)
                  setDemoScreen({ kind: 'inbox' })
                }}><MessageCircle aria-hidden="true" className="size-4 text-teal-800" />รายการแชต</button>}
                {context.kind === 'demo' && agentDemoOn && <ResearchDemoPanel demo={agentDemo}
                  onOpenStudyLead={() => selectAgent('director')}
                  onOpenRequest={(role, threadId, messageId) => selectAgent(role, threadId, messageId)}
                  onReset={() => selectAgent(null)} />}
              </div>
            </div>
          </div>
          {agent && (
            <div ref={panelRef} tabIndex={-1} aria-label="แชตในห้องแล็บ" role="region" className="lab-chat-panel" style={{ '--chat-width': `${chatWidth}px` } as CSSProperties}>
              <div className="lab-chat-divider" role="separator" tabIndex={0} aria-label="ปรับความกว้างแชต" aria-orientation="vertical"
                aria-valuemin={CHAT_MIN_WIDTH} aria-valuemax={CHAT_MAX_WIDTH} aria-valuenow={chatWidth}
                onPointerDown={(event) => {
                  if (event.button !== 0 || drag.current) return
                  const width = panelRef.current?.clientWidth ?? chatWidth
                  drag.current = { pointerId: event.pointerId, x: event.clientX, width, maxWidth: maxChatWidth(), nextWidth: width }
                  stopFollowing()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.preventDefault()
                }}
                onPointerMove={(event) => moveDivider(event.pointerId, event.clientX)}
                onPointerUp={(event) => { moveDivider(event.pointerId, event.clientX); finishDrag(event.pointerId) }}
                onPointerCancel={(event) => finishDrag(event.pointerId)}
                onLostPointerCapture={(event) => finishDrag(event.pointerId)}
                onKeyDown={(event) => {
                  const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
                  if (!direction || drag.current) return
                  event.preventDefault()
                  const width = panelRef.current?.clientWidth ?? chatWidth
                  stopFollowing()
                  commitWidth(Math.max(CHAT_MIN_WIDTH, Math.min(maxChatWidth(), width + direction * 24)))
                }} />
              {deskStudy ? <DeskAgentActivity study={deskStudy} role={agent} onClose={() => selectAgent(null)} onOpenGraph={(role) => openGraph(role)} />
                : <LabAgentChat key={JSON.stringify([chatScope, demoScreen.kind, demoScreen.kind === 'group' ? demoScreen.jobId : demoScreen.kind === 'private' ? demoScreen.threadId : null])}
                  chatScope={chatScope} drafts={drafts} setDrafts={setDrafts} lastThreads={lastThreads.current}
                  agent={agent} formula={undefined} chat={chat} onSelectAgent={selectAgent} onClose={() => {
                    selectAgent(null)
                    requestAnimationFrame(() => roleSelect.current?.focus({ preventScroll: true }))
                  }} progress={demoChat ? progress : undefined}
                  onModeChange={chooseChatMode}
                  sampleOpen={sampleOpen} agentDemo={agentDemoOn ? agentDemo : undefined} screen={demoScreen} navigate={setDemoScreen}
                  onOpenGraph={(role) => openGraph(role)} onReadingThread={rememberThread} />}
            </div>
          )}
        </div>

        {graphOpen && <section aria-label="กราฟการทดลอง" className="absolute inset-0 z-40 bg-white">
          <RoomGraph context={context} viewer={viewer} demo={agentDemo} timed={context.kind === 'timed' ? timed : null}
            requestedAgent={room.agent} onAgentChange={(role) => go(withView(room, 'graph', role), true)}
            onOpenLab={openLab} onBack={() => setView('room')} onChooseContext={goToHref} />
        </section>}

        {room.view === 'tools' && <aside aria-label="เครื่องมือแล็บ" className="lab-room-tools">
          <header className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">เครื่องมือแล็บ</h2>
            <button type="button" onClick={() => setView('room')} className="lab-room-chip">ปิด</button>
          </header>
          <p className="text-xs text-slate-600">งานปัจจุบัน · {contextLabel(context)}</p>
          {context.kind === 'timed'
            ? <TimedStudySummary studyId={context.studyId} fixture={context.fixture} timed={timed} onOpenGraph={() => openGraph(null)} />
            : <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">ใบงานตามเวลา</h3>
              <a className="lab-room-chip" href={`/lab-room?view=tools&study=${TIMED_FIXTURE}`}>ตัวอย่าง “ติดตามการเปลี่ยนสี” · ข้อมูลจำลอง</a>
            </section>}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">ในห้องนี้</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="lab-room-chip" aria-pressed={room.tool === 'station'}
                onClick={() => go({ ...room, view: 'room', tool: room.tool === 'station' ? null : 'station' })}>สถานีทดสอบสูตร</button>
              <button type="button" className="lab-room-chip" aria-pressed={room.tool === 'protein'}
                onClick={() => go({ ...room, view: 'room', tool: room.tool === 'protein' ? null : 'protein' })}>งานโปรตีนบนโต๊ะ</button>
              <a className="lab-room-chip" href={`/lab-room?demo=${DEMO_STUDY}${projectId ? `&projectId=${projectId}` : ''}`}>ตัวอย่าง D01 · ข้อมูลจำลอง</a>
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">หน้าที่ยังเปิดแยก</h3>
            <div className="flex flex-wrap gap-2">
              <a className="lab-room-chip" href={desk ? `/lab-room/orders?project=${desk.project}&order=${desk.order}` : projectId ? `/lab-room/orders?project=${projectId}` : '/lab-room/orders'}>ใบงาน Agent</a>
              <a className="lab-room-chip" href="/lab-room/protein">โปรตีน 3D</a>
              <a className="lab-room-chip" href={projectId ? `/assess?tab=assess&projectId=${projectId}` : '/assess?tab=assess'}>ประเมินสูตร (Studio)</a>
            </div>
          </section>
        </aside>}
      </div>
    </main>
  )
}
