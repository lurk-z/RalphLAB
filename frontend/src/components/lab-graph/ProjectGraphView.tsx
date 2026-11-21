'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { ArrowLeft, LoaderCircle, RotateCcw } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useAgentDemo } from '@/components/three/skincare-lab/chat/useAgentDemo'
import type { AgentRole } from '@/lib/lab-demo/events'
import { ROLE_EN } from '@/lib/lab-demo/roles'
import {
  AGENT_ORDER, agentNodeId, buildProjectGraph, emptyExploration, focusAgent, pathTo, toggleExpanded, visibleNodes,
  type Exploration, type GraphNode, type MessageRef,
} from '@/lib/lab-graph/model'
import { placeNodes } from '@/lib/lab-graph/layout'
import { loadGraphView, saveGraphView, viewKey } from '@/lib/lab-graph/view-memory'
import GraphDetail from './GraphDetail'
import type { CameraRequest } from './GraphCanvas'
import './graph.css'

const GraphCanvas = dynamic(() => import('./GraphCanvas'), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full place-items-center text-sm text-slate-500">กำลังโหลดกราฟ…</div>,
})

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/**
 * One read-only graph per project. Opening, expanding or closing it changes only this view's
 * memory; it never writes formulas, assessments or project drafts.
 */
export default function ProjectGraphView({ projectId, tabs, backHref, requestedAgent, onAgentChange, onOpenLab }: {
  projectId: number | null
  tabs: ReactNode
  backHref: string
  requestedAgent: AgentRole | null
  onAgentChange: (role: AgentRole) => void
  onOpenLab: (target: { message?: MessageRef; agent?: AgentRole }) => void
}) {
  const demo = useAgentDemo(projectId)
  const graph = useMemo(() => buildProjectGraph(demo.state), [demo.state])
  const latestGraph = useRef(graph)
  latestGraph.current = graph
  const key = viewKey(projectId)
  const memory = useRef(loadGraphView(key))
  const [exploration, setExploration] = useState<Exploration>(memory.current.exploration)
  const [camera, setCamera] = useState<CameraRequest | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [recording, setRecording] = useState(false)
  const nonce = useRef(0)
  const reducedMotion = useReducedMotion()
  const mobile = useIsMobile()

  const moveCamera = useCallback((id: string, fit = false) => setCamera({ id, fit, nonce: ++nonce.current }), [])

  const latestExploration = useRef(exploration)
  latestExploration.current = exploration
  const focus = useCallback((role: AgentRole, base?: Exploration) => {
    // Leaving the all-agents overview starts a fresh canvas around the chosen agent;
    // after that, every path and branch the user opened stays.
    const overview = !base && latestExploration.current.focus === null
    if (overview || base) memory.current.positions = {}
    const start = base ?? (overview ? emptyExploration() : latestExploration.current)
    setExploration(focusAgent(latestGraph.current, start, role))
    moveCamera(agentNodeId(latestGraph.current.projectId, role))
    setPanelOpen(true)
  }, [moveCamera])

  // Entry: the agent the user came from, otherwise every agent of the project.
  const entered = useRef<string | null>(null)
  useEffect(() => {
    const entry = `${graph.projectId}:${requestedAgent ?? ''}`
    if (entered.current === entry) return
    entered.current = entry
    if (requestedAgent) {
      if (exploration.focus !== agentNodeId(graph.projectId, requestedAgent)) focus(requestedAgent)
      else moveCamera(exploration.focus)
    } else if (!exploration.roots.length) {
      setExploration({ ...emptyExploration(), roots: AGENT_ORDER.map((role) => agentNodeId(graph.projectId, role)) })
      moveCamera(agentNodeId(graph.projectId, 'director'), true)
    } else moveCamera(exploration.focus ?? exploration.roots[0], true)
  }, [graph.projectId, requestedAgent, exploration.focus, exploration.roots, focus, moveCamera])

  const parents = useMemo(() => visibleNodes(graph, exploration), [graph, exploration])
  // Bumped when a dropped node or a reset changes stored positions without changing what is visible.
  const [layoutVersion, setLayoutVersion] = useState(0)
  const positions = useMemo(() => {
    const placed = placeNodes(graph, parents, memory.current.positions)
    // Hidden nodes keep their spot, so re-opening a branch puts it back where it was.
    memory.current.positions = { ...memory.current.positions, ...placed }
    return placed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, parents, layoutVersion])
  // One drag gesture (the grabbed node and the neighbours that followed it) is saved together,
  // and keeps its arrangement through collapsing branches and Lab → Graph.
  const move = useCallback((moved: Record<string, { x: number; y: number }>) => {
    memory.current.positions = { ...memory.current.positions, ...moved }
    saveGraphView(key, memory.current)
    setLayoutVersion((v) => v + 1)
  }, [key])
  useEffect(() => {
    memory.current.exploration = exploration
    saveGraphView(key, memory.current)
  }, [exploration, key, positions])

  const expanded = useMemo(() => new Set(exploration.expanded), [exploration.expanded])
  const path = useMemo(() => pathTo(parents, exploration.selected), [parents, exploration.selected])
  const selectedNode = exploration.selected ? graph.nodes[exploration.selected] : undefined
  const focusRole = exploration.focus ? graph.nodes[exploration.focus]?.role : undefined

  const select = useCallback((id: string) => {
    setExploration((current) => {
      // A node opened from the panel joins the canvas even if no open branch reaches it.
      const reachable = visibleNodes(graph, current).has(id)
      return { ...current, selected: id, roots: reachable ? current.roots : [...current.roots, id] }
    })
    setPanelOpen(true)
  }, [graph])
  const toggle = useCallback((id: string) => setExploration((current) => toggleExpanded(current, id)), [])

  const chooseAgent = (role: AgentRole) => {
    focus(role)
    onAgentChange(role)
  }
  const focusNode = (node: GraphNode) => node.role && chooseAgent(node.role)

  async function record() {
    setRecording(true)
    try {
      await demo.recordStudy()
    } finally {
      setRecording(false)
    }
    // Open the focused agent's branches from the newly recorded events.
    window.setTimeout(() => { if (focusRole) focus(focusRole) })
  }

  // Back to the automatic layout, dropping every dragged position.
  function resetView() {
    memory.current.positions = {}
    setLayoutVersion((v) => v + 1)
    const role = focusRole ?? requestedAgent
    if (role) focus(role, emptyExploration())
    else {
      setExploration({ ...emptyExploration(), roots: AGENT_ORDER.map((r) => agentNodeId(graph.projectId, r)) })
      moveCamera(agentNodeId(graph.projectId, 'director'), true)
    }
  }

  const switcher = <div role="group" aria-label="เลือก Agent ที่จะโฟกัส" className="flex items-center gap-1.5">
    {AGENT_ORDER.map((role) => {
      const active = focusRole === role
      return <button key={role} type="button" onClick={() => chooseAgent(role)} aria-pressed={active} title={ROLE_EN[role]} aria-label={`โฟกัส ${ROLE_EN[role]}`}
        className={`lab-graph-avatar ${active ? 'ring-2 ring-teal-600 ring-offset-2' : 'ring-1 ring-slate-200'}`}>
        <Image src={`/images/lab-agents/${role}-Photoroom.png`} alt="" width={512} height={768} unoptimized draggable={false} />
      </button>
    })}
  </div>

  const detail = selectedNode && <GraphDetail node={selectedNode} isFocus={selectedNode.id === exploration.focus}
    onClose={mobile ? undefined : () => setPanelOpen(false)} onSelect={select} onFocusAgent={focusNode}
    onOpenMessage={(message) => onOpenLab({ message })} onOpenChat={(node) => onOpenLab({ agent: node.role })} />

  return (
    <div className="app-light lab-graph-shell grid h-dvh grid-rows-[3.5rem_auto_minmax(0,1fr)] bg-background text-foreground">
      <header className="relative flex items-center border-b bg-card px-4">
        <a href={backHref} className="grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label="กลับหน้าหลัก"><ArrowLeft className="size-4" /></a>
        {tabs}
        <div className="ml-auto hidden lg:block">{switcher}</div>
      </header>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-2 text-sm">
        <nav aria-label="ตำแหน่ง" className="flex items-center gap-2 text-base">
          <span className="text-slate-500">{graph.experimentId}</span><span aria-hidden="true" className="text-slate-400">/</span>
          <span className="font-semibold text-slate-900">กราฟการทดลอง</span>
        </nav>
        {graph.recordedHandoffs > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">ข้อมูลจำลอง</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="lg:hidden">{switcher}</div>
          <button type="button" onClick={resetView} className="lab-graph-action" title="ล้างสาขาที่เปิดไว้"><RotateCcw aria-hidden="true" />จัดมุมมองใหม่</button>
        </div>
      </div>
      <div className="relative flex min-h-0">
        <div className="relative min-w-0 flex-1">
          <GraphCanvas graph={graph} parents={parents} positions={positions} expanded={expanded} focus={exploration.focus}
            selected={exploration.selected} path={path} camera={camera} reducedMotion={reducedMotion} onSelect={select} onToggle={toggle} onMove={move} />
          {graph.recordedHandoffs === 0 && demo.ready && (
            <div className="lab-graph-empty" role="status">
              <p className="font-semibold text-slate-900">ยังไม่มีเหตุการณ์ของ {graph.experimentId} ในโครงการนี้</p>
              <p className="mt-1 text-slate-600">สั่งงาน Agent ในแท็บ Lab แล้วกราฟจะเติบโตตามเหตุการณ์จริง หรือบันทึกบทเดโมทั้งรอบทันที</p>
              <button type="button" onClick={record} disabled={recording} className="lab-graph-action mt-3 bg-teal-700 text-white hover:bg-teal-800">
                {recording && <LoaderCircle aria-hidden="true" className="animate-spin" />}บันทึกบทเดโม {graph.experimentId} · ข้อมูลจำลอง
              </button>
            </div>
          )}
        </div>
        {!mobile && detail && panelOpen && <aside className="w-[380px] shrink-0 border-l bg-white">{detail}</aside>}
      </div>
      {mobile && <Sheet open={Boolean(detail && panelOpen)} onOpenChange={setPanelOpen}>
        <SheetContent side="bottom" className="max-h-[70dvh] overflow-hidden p-0">
          <SheetTitle className="sr-only">รายละเอียด {selectedNode?.label}</SheetTitle>
          <div className="flex max-h-[70dvh] flex-col">{detail}</div>
        </SheetContent>
      </Sheet>}
    </div>
  )
}
