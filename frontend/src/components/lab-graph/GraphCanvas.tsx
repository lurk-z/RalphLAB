'use client'

import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent,
} from 'react'
import Image from 'next/image'
import ReactFlow, {
  BaseEdge, Background, BackgroundVariant, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlowProvider,
  getBezierPath, useReactFlow, useStore, useViewport,
  type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { GraphNode, ProjectGraph } from '@/lib/lab-graph/model'
import type { Point } from '@/lib/lab-graph/layout'

type Size = 'focus' | 'open' | 'agent' | 'dot'
const RADIUS: Record<Size, number> = { focus: 66, open: 38, agent: 24, dot: 8 }

/** While a node is hovered or keyboard-focused: the node itself, a one-hop neighbour, or unrelated. */
type HoverRole = 'self' | 'near' | 'far'
/** hot: touches the hovered node · path: on the selected path · quiet: background · faded: unrelated during hover. */
type EdgeTone = 'hot' | 'path' | 'quiet' | 'faded'

type EntityData = {
  node: GraphNode
  size: Size
  hasChildren: boolean
  expanded: boolean
  selected: boolean
  onPath: boolean
  hover?: HoverRole
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onHover: (id: string | null) => void
}
type VerbData = { verb: string; tone: EdgeTone; sourceRadius: number; targetRadius: number; arrow: boolean }

/** Movement (px) beyond which a press on a node is a drag rather than a click. */
const DRAG_THRESHOLD = 4

/**
 * Elastic drag: share of the drag delta and lag time constant (ms) for visible nodes one and
 * two links from the grabbed node. Unrelated nodes stay put.
 */
const FOLLOW = [{ weight: 0.55, lag: 90 }, { weight: 0.2, lag: 150 }]
type Follower = { id: string; start: Point; weight: number; lag: number }
type Gesture = {
  id: string
  start: Point
  followers: Follower[]
  /** Grabbed node's displacement from its start, in flow coordinates. */
  delta: Point
  dragging: boolean
  /** Where each moved node is drawn now. */
  shown: Record<string, Point>
  lastTime: number
}

const hidden = { left: '50%', top: '50%', width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: 0, transform: 'translate(-50%, -50%)' }

const EntityNode = memo(function EntityNode({ data }: NodeProps<EntityData>) {
  const { node, size, hasChildren, expanded, selected, onPath, hover } = data
  const isAgent = node.kind === 'agent'

  // A press that moved is a drag: releasing it must not select anything.
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const press = (event: PointerEvent) => { pressedAt.current = { x: event.clientX, y: event.clientY } }
  const click = (event: ReactMouseEvent) => {
    const start = pressedAt.current
    pressedAt.current = null
    // detail 0 is a keyboard activation, never a drag.
    if (event.detail !== 0 && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD) return
    data.onSelect(node.id)
  }
  // Mouse and pen preview on hover; a touch tap only selects.
  const enter = (event: PointerEvent) => { if (event.pointerType !== 'touch') data.onHover(node.id) }
  const leave = (event: PointerEvent) => { if (event.pointerType !== 'touch') data.onHover(null) }

  const keys = (event: KeyboardEvent) => {
    if (!hasChildren) return
    if ((event.key === '+' || event.key === '=') && !expanded) { event.preventDefault(); data.onToggle(node.id) }
    if ((event.key === '-' || event.key === '_') && expanded) { event.preventDefault(); data.onToggle(node.id) }
  }
  // `nodrag`: the +/− control only expands or collapses; it never starts a drag.
  const toggle = hasChildren && (
    <button type="button" className="lab-graph-toggle nodrag nopan" data-size={size} onClick={(e) => { e.stopPropagation(); data.onToggle(node.id) }}
      aria-expanded={expanded} aria-label={`${expanded ? 'ยุบ' : 'ขยาย'} ${node.label}`} title={expanded ? 'ยุบสาขา' : 'ขยายสาขา'}>
      {expanded ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
    </button>
  )
  return (
    <div className="lab-graph-node" data-kind={node.kind} data-size={size} data-selected={selected || undefined} data-path={onPath || undefined}
      data-hover={hover} onPointerEnter={enter} onPointerLeave={leave}
      style={isAgent ? { width: RADIUS[size] * 2, height: RADIUS[size] * 2 } : undefined}>
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
      <button type="button" className="lab-graph-hit" onPointerDown={press} onClick={click} onKeyDown={keys}
        onFocus={() => data.onHover(node.id)} onBlur={() => data.onHover(null)}
        aria-pressed={selected} aria-label={`${node.label}${node.demo ? ' · ข้อมูลจำลอง' : ''}`} data-node-id={node.id}>
        {isAgent ? (
          <span className="lab-graph-portrait" aria-hidden="true">
            <Image src={`/images/lab-agents/${node.role}-Photoroom.png`} alt="" width={512} height={768} unoptimized draggable={false} />
          </span>
        ) : <span className="lab-graph-dot" aria-hidden="true" />}
        <span className="lab-graph-label">{node.label}</span>
      </button>
      {toggle}
    </div>
  )
})

/** The side a curve leaves from and enters by, along the dominant axis between the two nodes. */
function sides(dx: number, dy: number): [Position, Position] {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right]
  return dy >= 0 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom]
}
const OUTWARD: Record<Position, [number, number]> = {
  [Position.Right]: [1, 0], [Position.Left]: [-1, 0], [Position.Bottom]: [0, 1], [Position.Top]: [0, -1],
}

/**
 * Relationship edge: the original Nodes view's Bézier curve and moving dashes (`animated`).
 * It starts and ends on the portrait or dot boundary, points from the recorded source to the
 * target, and keeps its verb at the middle of the curve.
 */
function VerbEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }: EdgeProps<VerbData>) {
  const [sourcePosition, targetPosition] = sides(targetX - sourceX, targetY - sourceY)
  const s = (data?.sourceRadius ?? 0) + 3
  const t = (data?.targetRadius ?? 0) + 5
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sourceX + OUTWARD[sourcePosition][0] * s, sourceY: sourceY + OUTWARD[sourcePosition][1] * s, sourcePosition,
    targetX: targetX + OUTWARD[targetPosition][0] * t, targetY: targetY + OUTWARD[targetPosition][1] * t, targetPosition,
  })
  return <>
    <BaseEdge id={id} path={path} markerEnd={data?.arrow ? markerEnd : undefined} />
    {data?.verb && <EdgeLabelRenderer>
      <div className="lab-graph-verb" data-tone={data.tone}
        style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 10}px)` }}>{data.verb}</div>
    </EdgeLabelRenderer>}
  </>
}

const nodeTypes = { entity: EntityNode }
const edgeTypes = { verb: VerbEdge }

export type CameraRequest = { id: string; nonce: number; fit?: boolean }

type Props = {
  graph: ProjectGraph
  parents: Map<string, string | null>
  positions: Record<string, Point>
  expanded: Set<string>
  focus: string | null
  selected: string | null
  path: string[]
  camera: CameraRequest | null
  reducedMotion: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  /** Nodes moved by one drag gesture, at their settled positions (anchor centres, flow coordinates). */
  onMove: (positions: Record<string, Point>) => void
}

function sizeOf(node: GraphNode, focus: string | null, expanded: Set<string>): Size {
  if (node.kind !== 'agent') return 'dot'
  if (node.id === focus) return 'focus'
  return expanded.has(node.id) ? 'open' : 'agent'
}

function Canvas(props: Props) {
  const { graph, parents, positions, expanded, focus, selected, path, camera, reducedMotion, onSelect, onToggle, onMove } = props
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const sized = width > 0 && height > 0
  // Where nodes being dragged are right now; committed to the view memory on drop.
  const [live, setLive] = useState<Record<string, Point>>({})
  const [hoverId, setHoverId] = useState<string | null>(null)
  // The drag gesture in progress or settling (see "Elastic drag" below).
  const gesture = useRef<Gesture | null>(null)
  // During a gesture the highlight stays on the grabbed node, whatever slides under the pointer.
  const hoverFromNode = useCallback((id: string | null) => { if (!gesture.current) setHoverId(id) }, [])
  const onPath = useMemo(() => new Set(path), [path])
  const pathEdges = useMemo(() => {
    const pairs = new Set<string>()
    for (let i = 1; i < path.length; i++) pairs.add(`${path[i - 1]}|${path[i]}`).add(`${path[i]}|${path[i - 1]}`)
    return pairs
  }, [path])

  const sizes = useMemo(() => {
    const map = new Map<string, Size>()
    for (const id of parents.keys()) map.set(id, sizeOf(graph.nodes[id], focus, expanded))
    return map
  }, [graph, parents, focus, expanded])

  // Relationships drawn on the canvas now. Hover uses these, not the exploration tree, so a
  // shared record (one evidence used by two agents) shows every connection.
  const visibleEdges = useMemo(() => graph.edges.filter((e) =>
    parents.has(e.source) && parents.has(e.target) && positions[e.source] && positions[e.target]), [graph, parents, positions])

  const hover = useMemo(() => {
    if (!hoverId || !parents.has(hoverId)) return null
    const near = new Set<string>([hoverId])
    const incident = new Set<string>()
    for (const e of visibleEdges) if (e.source === hoverId || e.target === hoverId) {
      incident.add(e.id)
      near.add(e.source).add(e.target)
    }
    return { id: hoverId, near, incident }
  }, [hoverId, parents, visibleEdges])

  // Measured sizes, kept across renders: React Flow centres each node (nodeOrigin 0.5) from
  // its width/height, and a controlled node without them is drawn off-centre until re-measured.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({})

  const nodes = useMemo<Node<EntityData>[]>(() => [...parents.keys()].filter((id) => positions[id]).map((id) => ({
    id, type: 'entity', position: live[id] ?? positions[id], draggable: true, selectable: false,
    width: dims[id]?.width, height: dims[id]?.height,
    data: {
      node: graph.nodes[id], size: sizes.get(id)!, hasChildren: Boolean(graph.children[id]?.length),
      expanded: expanded.has(id), selected: selected === id, onPath: !hover && onPath.has(id),
      hover: hover ? (id === hover.id ? 'self' : hover.near.has(id) ? 'near' : 'far') : undefined,
      onSelect, onToggle, onHover: hoverFromNode,
    },
  })), [parents, positions, live, dims, graph, sizes, expanded, selected, onPath, hover, onSelect, onToggle, hoverFromNode])

  const edges = useMemo<Edge<VerbData>[]>(() => visibleEdges.map((e) => {
    // A hover preview replaces the selected path until the pointer leaves.
    const tone: EdgeTone = hover
      ? hover.incident.has(e.id) ? 'hot' : 'faded'
      : pathEdges.has(`${e.source}|${e.target}`) ? 'path' : 'quiet'
    const accent = tone === 'hot' || tone === 'path'
    return {
      id: e.id, source: e.source, target: e.target, type: 'verb', focusable: false,
      animated: !reducedMotion, className: `lab-graph-edge is-${tone}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: accent ? '#0f8f7e' : '#9aa5b1' },
      data: { verb: e.verb, tone, arrow: Boolean(e.verb), sourceRadius: RADIUS[sizes.get(e.source) ?? 'dot'], targetRadius: RADIUS[sizes.get(e.target) ?? 'dot'] },
    }
  }), [visibleEdges, hover, pathEdges, sizes, reducedMotion])

  // ---- Elastic drag ------------------------------------------------------------------------
  // The grabbed node follows the pointer exactly. Visible neighbours follow a weighted share of
  // the drag with a short damped lag; one animation loop runs while dragging or settling, and
  // the whole arrangement is saved once it has settled.
  const liveRef = useRef(live)
  liveRef.current = live
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const visibleEdgesRef = useRef(visibleEdges)
  visibleEdgesRef.current = visibleEdges
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const frame = useRef(0)
  const shownAt = (id: string): Point => liveRef.current[id] ?? positionsRef.current[id]

  const finish = useCallback(() => {
    const g = gesture.current
    if (!g) return
    window.cancelAnimationFrame(frame.current)
    frame.current = 0
    gesture.current = null
    const ids = [g.id, ...g.followers.map((f) => f.id)]
    // Nothing really moved (a press without a drag): leave the saved layout alone.
    if (Math.hypot(g.delta.x, g.delta.y) >= 0.5) {
      const final: Record<string, Point> = {}
      for (const id of ids) {
        const at = g.shown[id] ?? liveRef.current[id]
        if (at) final[id] = { x: at.x, y: at.y }
      }
      onMove(final)
    }
    setLive((current) => {
      const rest = { ...current }
      for (const id of ids) delete rest[id]
      return rest
    })
  }, [onMove])

  const step = useCallback((time: number) => {
    const g = gesture.current
    if (!g) return
    const dt = Math.min(64, g.lastTime ? time - g.lastTime : 16)
    g.lastTime = time
    let settled = true
    const next: Record<string, Point> = {}
    for (const f of g.followers) {
      const target = { x: f.start.x + g.delta.x * f.weight, y: f.start.y + g.delta.y * f.weight }
      const at = g.shown[f.id] ?? f.start
      const k = 1 - Math.exp(-dt / f.lag)
      let x = at.x + (target.x - at.x) * k
      let y = at.y + (target.y - at.y) * k
      if (Math.hypot(target.x - x, target.y - y) < 0.3) { x = target.x; y = target.y } else settled = false
      next[f.id] = g.shown[f.id] = { x, y }
    }
    if (g.followers.length) setLive((current) => ({ ...current, ...next }))
    // Keep running while the pointer is held (so a pause catches up); after release, stop once settled.
    if (!g.dragging && settled) finish()
    else frame.current = window.requestAnimationFrame(step)
  }, [finish])

  const onNodeDragStart = useCallback((_: ReactMouseEvent, node: Node) => {
    // Grabbing mid-settle: what is on screen becomes the starting point; the previous
    // arrangement is saved as it stands.
    const previous = gesture.current
    const snapshot = (id: string) => ({ ...shownAt(id) })
    if (previous) {
      window.cancelAnimationFrame(frame.current)
      frame.current = 0
      gesture.current = null
      const current: Record<string, Point> = {}
      for (const id of [previous.id, ...previous.followers.map((f) => f.id)]) current[id] = snapshot(id)
      onMove(current)
    }
    // Followers by their shortest visible distance from the grabbed node, edges in both directions.
    const links = new Map<string, string[]>()
    for (const e of visibleEdgesRef.current) {
      links.set(e.source, [...(links.get(e.source) ?? []), e.target])
      links.set(e.target, [...(links.get(e.target) ?? []), e.source])
    }
    const hops = new Map<string, number>([[node.id, 0]])
    const queue = [node.id]
    while (queue.length) {
      const id = queue.shift()!
      const hop = hops.get(id)!
      if (hop >= FOLLOW.length) continue
      for (const next of links.get(id) ?? []) if (!hops.has(next)) { hops.set(next, hop + 1); queue.push(next) }
    }
    const followers = [...hops].filter(([, hop]) => hop > 0).map(([id, hop]) => ({ id, start: snapshot(id), ...FOLLOW[hop - 1] }))
    gesture.current = { id: node.id, start: snapshot(node.id), followers, delta: { x: 0, y: 0 }, dragging: true, shown: {}, lastTime: 0 }
    // The highlight stays on the grabbed node while followers slide under the pointer.
    setHoverId(node.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const moved: Record<string, Point> = {}
    const measured: Record<string, { width: number; height: number }> = {}
    for (const change of changes) {
      if (change.type === 'position' && change.dragging && change.position) moved[change.id] = change.position
      if (change.type === 'dimensions' && change.dimensions) measured[change.id] = change.dimensions
    }
    const g = gesture.current
    const grabbed = g && moved[g.id]
    if (g && grabbed) {
      g.delta = { x: grabbed.x - g.start.x, y: grabbed.y - g.start.y }
      if (reducedRef.current) {
        // Reduced motion: weighted positions at once, no lag.
        for (const f of g.followers) moved[f.id] = g.shown[f.id] = { x: f.start.x + g.delta.x * f.weight, y: f.start.y + g.delta.y * f.weight }
      } else if (!frame.current && g.followers.length) frame.current = window.requestAnimationFrame(step)
    }
    if (Object.keys(moved).length) setLive((current) => ({ ...current, ...moved }))
    if (Object.keys(measured).length) setDims((current) => {
      const same = Object.entries(measured).every(([id, d]) => current[id]?.width === d.width && current[id]?.height === d.height)
      return same ? current : { ...current, ...measured }
    })
  }, [step])

  const onNodeDragStop = useCallback(() => {
    const g = gesture.current
    if (!g) return
    g.dragging = false
    g.shown[g.id] = liveRef.current[g.id] ?? g.start
    // Reduced motion, or a hidden page where animation frames never run: place followers at
    // their weighted targets and save now. Otherwise followers settle first.
    if (reducedRef.current || document.hidden) {
      const placed: Record<string, Point> = {}
      for (const f of g.followers) placed[f.id] = g.shown[f.id] = { x: f.start.x + g.delta.x * f.weight, y: f.start.y + g.delta.y * f.weight }
      setLive((current) => ({ ...current, ...placed }))
    }
    if (!frame.current || reducedRef.current || document.hidden) finish()
  }, [finish])

  useEffect(() => () => window.cancelAnimationFrame(frame.current), [])

  // Fit what is on the canvas from known positions (labels sit right of / below their anchor).
  const fit = useCallback((duration: number) => {
    const points = Object.values(positions)
    if (!points.length) return
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    const left = Math.min(...xs) - 90, right = Math.max(...xs) + 220
    const top = Math.min(...ys) - 90, bottom = Math.max(...ys) + 110
    const zoom = Math.max(0.35, Math.min(1.1, (width / (right - left)) * 0.92, (height / (bottom - top)) * 0.92))
    flow.setCenter((left + right) / 2, (top + bottom) / 2, { zoom, duration })
  }, [positions, flow, width, height])

  // Camera moves only when asked (focusing an agent or fit-to-view), never when reading or dropping a node.
  const handled = useRef(0)
  const lastMove = useRef<{ camera: CameraRequest; at: number } | null>(null)
  useEffect(() => {
    if (!sized || !camera || camera.nonce === handled.current) return
    const point = positions[camera.id]
    if (!point && !camera.fit) return
    const duration = reducedMotion ? 0 : 450
    const frame = window.requestAnimationFrame(() => {
      handled.current = camera.nonce
      lastMove.current = { camera, at: Date.now() }
      if (camera.fit) fit(duration)
      else flow.setCenter(point.x, point.y, { zoom: flow.getZoom(), duration })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [sized, camera, positions, flow, reducedMotion, fit])

  // The detail panel opening right after a move narrows the canvas: keep the target centred.
  useEffect(() => {
    const last = lastMove.current
    if (!last || Date.now() - last.at > 1500) return
    const point = positions[last.camera.id]
    if (last.camera.fit) fit(0)
    else if (point) flow.setCenter(point.x, point.y, { zoom: flow.getZoom(), duration: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  const duration = reducedMotion ? 0 : 200
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodeOrigin={[0.5, 0.5]}
      onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
      nodeDragThreshold={0}
      nodesDraggable nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false}
      deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} zoomOnDoubleClick={false}
      minZoom={0.3} maxZoom={2} defaultViewport={{ x: 0, y: 0, zoom: 1 }} proOptions={{ hideAttribution: true }}
      className={hover ? 'is-hovering' : undefined} aria-label="กราฟการทดลอง">
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#d5dbe1" />
      <div className="lab-graph-zoom" role="group" aria-label="ซูมกราฟ">
        <button type="button" onClick={() => flow.zoomOut({ duration })} aria-label="ซูมออก" title="ซูมออก"><Minus aria-hidden="true" /></button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => flow.zoomIn({ duration })} aria-label="ซูมเข้า" title="ซูมเข้า"><Plus aria-hidden="true" /></button>
        <button type="button" onClick={() => fit(reducedMotion ? 0 : 400)} aria-label="พอดีกับหน้าจอ" title="พอดีกับหน้าจอ"><Maximize aria-hidden="true" /></button>
      </div>
    </ReactFlow>
  )
}

export default function GraphCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}
