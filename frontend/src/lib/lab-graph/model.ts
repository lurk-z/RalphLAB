/**
 * Project graph · built only from the project's recorded Lab events.
 *
 * The same `LabDemoState` drives the Lab chat, the handoffs and the 3D room. This module
 * turns it into entities (agents, formula versions, evidence, results, sources) with stable
 * project-scoped ids and directed relationships. Fixtures (see ./fixtures.ts) only add
 * details to a record whose event already exists; they never create a relationship alone.
 *
 * Pure and framework-free so the backend feed can replace the demo state later.
 */
import type { AgentRole, ChatMessage, Handoff, LabDemoState, LabEvent, Task } from '../lab-demo/events.ts'
import { groupThreadId } from '../lab-demo/events.ts'
import { ROLE_EN, ROLE_TH } from '../lab-demo/roles.ts'
import { HANDOFFS } from '../lab-demo/study-example.ts'
import { D01_FIXTURES, type StudyFixtures } from './fixtures.ts'

export const AGENT_ORDER: AgentRole[] = ['director', 'formulator', 'analyst', 'researcher', 'evaluator']

export type NodeKind = 'agent' | 'branch' | 'formula' | 'evidence' | 'result' | 'decision' | 'query' | 'document' | 'missing'
export type BranchKey = 'received' | 'created' | 'sent' | 'used' | 'results' | 'queries' | 'documents'

export const BRANCH_LABEL: Record<BranchKey, string> = {
  received: 'โจทย์ที่รับ',
  created: 'สูตรที่สร้าง',
  sent: 'งานที่ส่งต่อ',
  used: 'หลักฐานที่ใช้',
  results: 'ผลที่รายงาน',
  queries: 'คำค้น',
  documents: 'เอกสารต้นทาง',
}
const BRANCH_ORDER: BranchKey[] = ['received', 'created', 'sent', 'used', 'results', 'queries', 'documents']

/** Short verbs. Arrows always point the way the recorded event went. */
export const VERB = {
  assigned: 'มอบหมาย',
  sent: 'ส่ง',
  created: 'สร้าง',
  derived: 'แตกรุ่น',
  supplied: 'ส่งหลักฐาน',
  usedAsEvidence: 'ใช้เป็นหลักฐาน',
  reported: 'รายงาน',
  assessed: 'ประเมิน',
  opened: 'เปิดอ่าน',
  searched: 'ค้นหา',
  concluded: 'สรุป',
} as const

export type Fact = { label: string; value: string; link?: string }
export type MessageRef = { messageId: string; threadId: string; agent: AgentRole; jobId?: string; group: boolean }
export type DetailList = { title: string; items: { label: string; note?: string; link?: string }[] }

export type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  role?: AgentRole
  branch?: BranchKey
  /** The agent a branch or agent node belongs to. */
  owner?: AgentRole
  demo: boolean
  heading: string
  summary?: string
  facts: Fact[]
  lists: DetailList[]
  message?: MessageRef
  eventIds: string[]
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  /** Empty for the structural link between an agent and its own branch. */
  verb: string
  eventIds: string[]
}

export type ProjectGraph = {
  projectId: string
  experimentId: string
  nodes: Record<string, GraphNode>
  edges: GraphEdge[]
  /** What a node reveals when the user expands it, in display order. */
  children: Record<string, string[]>
  /** Recorded handoffs of the study. 0 means the project has no D01 events yet. */
  recordedHandoffs: number
}

export const agentNodeId = (projectId: string, role: AgentRole) => `${projectId}:agent:${role}`
export const branchNodeId = (projectId: string, role: AgentRole, key: BranchKey) => `${projectId}:agent:${role}:${key}`
export const formulaNodeId = (projectId: string, experimentId: string, version: string) => `${projectId}:formula:${experimentId}:${version}`
export const evidenceNodeId = (projectId: string, experimentId: string, id: string) => `${projectId}:evidence:${experimentId}:${id}`
const resultNodeId = (projectId: string, experimentId: string, version: string) => `${projectId}:result:${experimentId}:${version}`

const privateRole = (threadId: string): AgentRole | undefined =>
  AGENT_ORDER.find((role) => new RegExp(`:private:${role}(?::|$)`).test(threadId))

export function buildProjectGraph(state: LabDemoState, fixtures: StudyFixtures = D01_FIXTURES): ProjectGraph {
  const p = state.projectId
  const x = fixtures.experimentId
  const nodes: Record<string, GraphNode> = {}
  const edges = new Map<string, GraphEdge>()
  const children: Record<string, string[]> = {}
  const messagesById = new Map(state.messages.map((m) => [m.messageId, m]))

  const add = (node: GraphNode) => {
    const existing = nodes[node.id]
    if (existing) {
      existing.eventIds = [...new Set([...existing.eventIds, ...node.eventIds])]
      return existing
    }
    nodes[node.id] = node
    return node
  }
  const link = (source: string, target: string, verb: string, eventIds: (string | undefined)[] = []) => {
    const id = `${source}>${verb}>${target}`
    const ids = eventIds.filter((e): e is string => Boolean(e))
    const existing = edges.get(id)
    if (existing) existing.eventIds = [...new Set([...existing.eventIds, ...ids])]
    else edges.set(id, { id, source, target, verb, eventIds: [...new Set(ids)] })
  }
  const reveal = (parent: string, child: string) => {
    const list = (children[parent] ??= [])
    if (!list.includes(child)) list.push(child)
  }

  // Events of interest, looked up by what they recorded.
  const sentEvent = new Map<string, LabEvent>()
  const acceptedEvent = new Map<string, LabEvent>()
  for (const event of state.log) {
    if (event.type === 'handoff.sent' && !sentEvent.has(event.handoffId)) sentEvent.set(event.handoffId, event)
    if (event.type === 'handoff.accepted') acceptedEvent.set(event.handoffId, event)
  }
  const stepDoneEvent = (taskId: string, stepId: string) => state.log.find((e) =>
    e.type === 'task.step' && e.taskId === taskId && e.stepId === stepId && e.status === 'done')?.eventId
  const completedEvent = (taskId: string) => state.log.find((e) => e.type === 'task.completed' && e.taskId === taskId)?.eventId

  // Only a message that exists in the project's chat can be opened.
  const messageRef = (messageId: string, fallback: AgentRole, jobId?: string): MessageRef | undefined => {
    const threadId = messagesById.get(messageId)?.threadId
    if (!threadId) return undefined
    const group = threadId === groupThreadId(p) || state.threads[threadId]?.kind === 'group'
    return { messageId, threadId, agent: group ? fallback : privateRole(threadId) ?? fallback, jobId, group }
  }
  const handoffMessage = (h: Handoff) => messageRef(`handoff:${h.handoffId}`, h.from, h.jobId)

  // Agents and their branches.
  const tasksOf = (role: AgentRole) => Object.values(state.tasks).filter((t) => t.owner === role)
  for (const role of AGENT_ORDER) {
    const tasks = tasksOf(role)
    add({
      id: agentNodeId(p, role), kind: 'agent', label: ROLE_EN[role], role, owner: role, demo: false,
      heading: ROLE_EN[role],
      summary: ROLE_TH[role],
      facts: [{ label: 'งานที่รับผิดชอบ', value: tasks.length ? `${tasks.length} งาน` : 'ยังไม่มีงานที่บันทึก' }],
      lists: tasks.length ? [{ title: 'งานที่ทำ', items: tasks.map(taskItem) }] : [],
      eventIds: [],
    })
  }
  const branch = (role: AgentRole, key: BranchKey) => {
    const id = branchNodeId(p, role, key)
    if (!nodes[id]) add({
      id, kind: 'branch', label: BRANCH_LABEL[key], branch: key, owner: role, demo: false,
      heading: `${BRANCH_LABEL[key]} · ${ROLE_EN[role]}`, facts: [], lists: [], eventIds: [],
    })
    return id
  }

  // Handoffs in the order they were first sent.
  const handoffs = Object.values(state.handoffs).sort((a, b) =>
    (sentEvent.get(a.handoffId)?.sequence ?? 0) - (sentEvent.get(b.handoffId)?.sequence ?? 0))
  const stageOf = (h: Handoff) => h.stage ? HANDOFFS.find((row) => row.id === h.stage && row.from === h.from && row.to === h.to) : undefined
  const evidenceByStage = new Map(Object.values(fixtures.evidence).map((e) => [e.stage, e]))
  const formulaByStage = new Map(Object.values(fixtures.formulas).map((f) => [f.stage, f]))

  // 1 · Evidence: a recorded delivery whose stage carries an evidence record.
  for (const h of handoffs) {
    const fixture = h.stage ? evidenceByStage.get(h.stage) : undefined
    if (!fixture) continue
    const sent = sentEvent.get(h.handoffId)?.eventId
    const accepted = h.status === 'accepted' ? acceptedEvent.get(h.handoffId)?.eventId : undefined
    const id = evidenceNodeId(p, x, fixture.id)
    add({
      id, kind: 'evidence', label: fixture.label, demo: true, heading: fixture.label, summary: fixture.summary,
      facts: [
        { label: 'ที่มา', value: ROLE_EN[h.from], link: agentNodeId(p, h.from) },
        { label: 'ประเด็น', value: fixture.endpoint },
        { label: 'ระเบียน', value: fixture.record },
        { label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' },
        { label: 'สถานะการส่ง', value: accepted ? `${ROLE_EN[h.to]} รับแล้ว` : 'กำลังส่ง' },
      ],
      lists: [], message: handoffMessage(h), eventIds: [sent, accepted].filter(Boolean) as string[],
    })
    const supplier = agentNodeId(p, h.from)
    link(supplier, id, VERB.supplied, [sent])
    reveal(id, supplier)
    reveal(supplier, id)
    if (accepted) {
      const used = branch(h.to, 'used')
      link(id, used, VERB.usedAsEvidence, [accepted])
      reveal(used, id)
    }

    // Where the supplier's information came from. Only recorded steps count as findings.
    const queries = branch(h.from, 'queries')
    if (fixture.query) {
      const queryId = `${id}:query`
      add({ id: queryId, kind: 'query', label: fixture.query, demo: true, heading: 'คำค้น', summary: fixture.query, facts: [{ label: 'ผู้ค้น', value: ROLE_EN[h.from] }], lists: [], eventIds: [] })
      link(queries, queryId, VERB.searched, [sent])
      reveal(queries, queryId)
    } else {
      const missing = `${id}:no-query`
      add({ id: missing, kind: 'missing', label: 'ไม่มีคำค้นที่บันทึกไว้', demo: true, heading: 'คำค้น',
        summary: `เดโมนี้ไม่ได้บันทึกคำค้นที่ ${ROLE_EN[h.from]} ใช้หา ${fixture.label}`,
        facts: [{ label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' }], lists: [], eventIds: [] })
      reveal(queries, missing)
      link(queries, missing, '')
    }
    const documents = branch(h.from, 'documents')
    const supplierTask = Object.values(state.tasks).find((t) => t.owner === h.from && t.jobId === h.jobId &&
      t.steps.some((s) => s.stepId === fixture.document?.stepId && s.status === 'done'))
    const opened = supplierTask && fixture.document ? stepDoneEvent(supplierTask.taskId, fixture.document.stepId) : undefined
    if (fixture.document && opened) {
      const docId = `${id}:document`
      add({ id: docId, kind: 'document', label: fixture.document.label, demo: true, heading: fixture.document.label,
        summary: fixture.document.real ? undefined : 'ไม่มีเอกสารต้นทางจริงในเดโม มีเพียงบันทึกตัวอย่างที่ Agent เปิดอ่าน',
        facts: [
          { label: 'ผู้เปิดอ่าน', value: ROLE_EN[h.from], link: agentNodeId(p, h.from) },
          { label: 'ใช้กับ', value: fixture.label, link: id },
          { label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' },
        ],
        lists: [], message: supplierTask ? messageRef(supplierTask.taskId + ':work', h.from, h.jobId) ?? messageRef(supplierTask.acceptedMessageId, h.from, h.jobId) : undefined,
        eventIds: [opened] })
      link(documents, docId, VERB.opened, [opened])
      reveal(documents, docId)
    } else {
      const missing = `${id}:no-document`
      add({ id: missing, kind: 'missing', label: 'ยังไม่มีเอกสารที่บันทึก', demo: true, heading: 'เอกสารต้นทาง',
        summary: 'ยังไม่มีเหตุการณ์ที่บันทึกว่าเปิดเอกสารต้นทางของหลักฐานนี้', facts: [], lists: [], eventIds: [] })
      reveal(documents, missing)
      link(documents, missing, '')
    }
  }

  // 2 · Formula versions: a recorded sample delivery creates its version.
  for (const h of handoffs) {
    const fixture = h.stage ? formulaByStage.get(h.stage) : undefined
    if (!fixture) continue
    const sent = sentEvent.get(h.handoffId)?.eventId
    const id = formulaNodeId(p, x, fixture.version)
    const parentId = fixture.parent ? formulaNodeId(p, x, fixture.parent) : undefined
    const evidence = fixture.evidence.map((e) => evidenceNodeId(p, x, e)).filter((e) => nodes[e])
    add({
      id, kind: 'formula', label: fixture.version, demo: true, heading: `${x} · ${fixture.version}`,
      summary: fixture.change,
      facts: [
        { label: 'รุ่นแม่', value: fixture.parent ?? 'ไม่มี (รุ่นแรก)', link: parentId && nodes[parentId] ? parentId : undefined },
        { label: 'สิ่งที่เปลี่ยน', value: fixture.change },
        { label: 'เหตุผล', value: fixture.reason },
        { label: 'ผู้สร้าง', value: ROLE_EN[h.from], link: agentNodeId(p, h.from) },
        { label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' },
      ],
      lists: [
        { title: 'ส่วนผสม', items: fixture.ingredients.map((i) => ({ label: `${i.name} ${i.percent}%`, note: i.role })) },
        { title: 'หลักฐานที่ใช้', items: evidence.length
          ? evidence.map((e) => ({ label: nodes[e].label, note: nodes[e].summary, link: e }))
          : [{ label: fixture.evidence.length ? 'ยังไม่มีหลักฐานที่บันทึก' : 'ไม่มี (รุ่นตั้งต้นจากใบงาน)' }] },
      ],
      message: handoffMessage(h), eventIds: sent ? [sent] : [],
    })
    const created = branch(h.from, 'created')
    link(created, id, VERB.created, [sent])
    if (parentId && nodes[parentId]) {
      link(parentId, id, VERB.derived, [sent])
      reveal(parentId, id)
      // A version whose parent this agent also created is reached through the lineage.
      if (!children[created]?.includes(parentId)) reveal(created, id)
    } else reveal(created, id)
    for (const e of evidence) {
      link(e, id, VERB.usedAsEvidence, [sent])
      reveal(id, e)
      reveal(e, id)
    }
  }
  // 3 · Work handoffs (everything that is not an evidence delivery).
  for (const h of handoffs) {
    if (h.stage && evidenceByStage.has(h.stage)) continue
    const sent = sentEvent.get(h.handoffId)?.eventId
    const sentBranch = branch(h.from, 'sent')
    const recipient = agentNodeId(p, h.to)
    link(sentBranch, recipient, VERB.sent, [sent])
    reveal(sentBranch, recipient)
    if (h.status === 'accepted') {
      const accepted = acceptedEvent.get(h.handoffId)?.eventId
      const received = branch(h.to, 'received')
      const sender = agentNodeId(p, h.from)
      link(sender, received, VERB.assigned, [sent, accepted])
      reveal(received, sender)
    }
    const row = stageOf(h)
    pushItem(sentBranch, { label: `${h.title} → ${ROLE_EN[h.to]}`, note: statusText(h) + (row?.note ? ` · ${row.note}` : '') })
    if (h.status === 'accepted') pushItem(branch(h.to, 'received'), { label: `${h.title} ← ${ROLE_EN[h.from]}`, note: row?.note })
  }

  // 4 · Reported results and the closing decision (task.completed events).
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'completed') continue
    const done = completedEvent(task.taskId)
    const summary = state.messages.find((m): m is Extract<ChatMessage, { kind: 'agent' }> => m.kind === 'agent' && m.messageId === task.taskId + ':summary')
    const assessment = summary?.assessment
    if (assessment) {
      const id = resultNodeId(p, x, assessment.formulaName)
      const formula = formulaNodeId(p, x, assessment.formulaName)
      add({
        id, kind: 'result', label: `ผล ${assessment.formulaName} · 4 ด้าน`, demo: assessment.source === 'demo',
        heading: `ผลคัดกรอง ${assessment.formulaName}`, summary: assessment.method,
        facts: [
          { label: 'สูตร', value: assessment.formulaName, link: nodes[formula] ? formula : undefined },
          { label: 'ผู้รายงาน', value: ROLE_EN[task.owner], link: agentNodeId(p, task.owner) },
          { label: 'ประเภทข้อมูล', value: assessment.source === 'demo' ? 'ข้อมูลจำลอง' : 'ผลจาก Assessment' },
        ],
        lists: [{ title: 'รายด้าน', items: assessment.rows.map((r) => ({ label: `${r.label} · ${r.score === null ? 'unknown' : r.score + '/100'}`, note: r.finding })) }],
        message: messageRef(summary.messageId, task.owner, task.jobId), eventIds: done ? [done] : [],
      })
      const results = branch(task.owner, 'results')
      link(results, id, VERB.reported, [done])
      reveal(results, id)
      if (nodes[formula]) {
        link(id, formula, VERB.assessed, [done])
        reveal(id, formula)
        reveal(formula, id)
      }
    } else if (task.taskId.endsWith(':decision') && summary) {
      const id = `${p}:decision:${x}:${task.taskId}`
      add({ id, kind: 'decision', label: `ข้อสรุป ${x}`, demo: true, heading: `ข้อสรุป ${x}`, summary: task.summary,
        facts: [{ label: 'ผู้ตัดสิน', value: ROLE_EN[task.owner], link: agentNodeId(p, task.owner) }, { label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' }],
        lists: [], message: messageRef(summary.messageId, task.owner, task.jobId), eventIds: done ? [done] : [] })
      const results = branch(task.owner, 'results')
      link(results, id, VERB.concluded, [done])
      reveal(results, id)
    }
  }
  // Results that motivated a version (recorded only when both exist).
  for (const f of Object.values(fixtures.formulas)) {
    const id = formulaNodeId(p, x, f.version)
    if (!nodes[id]) continue
    for (const version of f.basedOnResultsOf) {
      const result = resultNodeId(p, x, version)
      if (!nodes[result]) continue
      link(result, id, VERB.usedAsEvidence)
      nodes[id].lists.push({ title: 'ผลที่ใช้ตัดสินใจ', items: [{ label: nodes[result].label, link: result }] })
    }
  }

  // Formula versions that used each evidence record.
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'evidence') continue
    const versions = [...edges.values()].filter((e) => e.source === node.id && nodes[e.target]?.kind === 'formula').map((e) => nodes[e.target])
    node.facts.splice(2, 0, { label: 'สูตรที่เกี่ยวข้อง', value: versions.length ? versions.map((v) => v.label).join(' → ') : 'ยังไม่มีสูตรที่ใช้' })
    if (versions.length) node.lists.push({ title: 'สูตรที่ใช้หลักฐานนี้', items: versions.map((v) => ({ label: v.label, note: v.summary, link: v.id })) })
  }

  // Agent → branch structure (non-empty branches only), then supplied evidence.
  for (const role of AGENT_ORDER) {
    const agent = agentNodeId(p, role)
    for (const key of BRANCH_ORDER) {
      const id = branchNodeId(p, role, key)
      if (!nodes[id] || !(children[id]?.length)) continue
      link(agent, id, '')
      reveal(agent, id)
      const branchNode = nodes[id]
      if (!branchNode.lists.length) branchNode.lists.push({ title: 'รายการ', items: children[id].map((c) => ({ label: nodes[c].label, link: c })) })
    }
    const supplied = [...(children[agent] ?? [])].filter((c) => nodes[c].kind === 'evidence')
    if (supplied.length) children[agent] = [...children[agent].filter((c) => nodes[c].kind !== 'evidence'), ...supplied]
  }

  // A version lists its child versions first, then what supports it.
  const rank = (id: string) => ({ formula: 0, evidence: 1, result: 2 } as Record<string, number>)[nodes[id].kind] ?? 3
  for (const node of Object.values(nodes)) if (node.kind === 'formula' && children[node.id]) children[node.id].sort((a, b) => rank(a) - rank(b))

  return { projectId: p, experimentId: x, nodes, edges: [...edges.values()], children, recordedHandoffs: handoffs.length }

  function pushItem(branchId: string, item: DetailList['items'][number]) {
    const node = nodes[branchId]
    let list = node.lists.find((l) => l.title === 'ใบงาน')
    if (!list) node.lists.push(list = { title: 'ใบงาน', items: [] })
    list.items.push(item)
  }
}

function statusText(h: Handoff) {
  return h.status === 'accepted' ? 'รับแล้ว' : h.status === 'failed' ? 'ส่งไม่สำเร็จ' : 'กำลังส่ง'
}

function taskItem(task: Task) {
  const done = task.steps.filter((s) => s.status === 'done').length
  return { label: task.title, note: task.status === 'completed' ? 'เสร็จแล้ว' : task.steps.length ? `${done}/${task.steps.length} ขั้นตอน` : 'รับงานแล้ว' }
}

// ---------------------------------------------------------------- exploration

/** What the user has opened. Kept per project above the lifetime of the Graph tab. */
export type Exploration = {
  /** Agents the user has focused, in order. Each one stays on the canvas. */
  roots: string[]
  expanded: string[]
  focus: string | null
  selected: string | null
}

export const emptyExploration = (): Exploration => ({ roots: [], expanded: [], focus: null, selected: null })

/** Visible nodes and the node that first revealed each one (the path the user followed). */
export function visibleNodes(graph: ProjectGraph, exploration: Exploration) {
  const parent = new Map<string, string | null>()
  const expanded = new Set(exploration.expanded)
  const queue: string[] = []
  for (const root of exploration.roots) if (graph.nodes[root] && !parent.has(root)) { parent.set(root, null); queue.push(root) }
  while (queue.length) {
    const id = queue.shift()!
    if (!expanded.has(id)) continue
    for (const child of graph.children[id] ?? []) {
      if (parent.has(child) || !graph.nodes[child]) continue
      parent.set(child, id)
      queue.push(child)
    }
  }
  return parent
}

/** Focusing an agent opens its branches and the first hop of where its evidence came from. */
export function focusAgent(graph: ProjectGraph, exploration: Exploration, role: AgentRole): Exploration {
  const id = agentNodeId(graph.projectId, role)
  const open = new Set(exploration.expanded)
  open.add(id)
  for (const b of graph.children[id] ?? []) {
    const node = graph.nodes[b]
    if (node.kind !== 'branch') continue
    open.add(b)
    if (node.branch === 'used') for (const e of graph.children[b] ?? []) open.add(e)
    if (node.branch === 'created') for (const f of graph.children[b] ?? []) open.add(f)
  }
  const roots = exploration.roots.includes(id) ? exploration.roots : [...exploration.roots, id]
  return { roots, expanded: [...open], focus: id, selected: id }
}

export function toggleExpanded(exploration: Exploration, id: string): Exploration {
  const expanded = exploration.expanded.includes(id)
    ? exploration.expanded.filter((e) => e !== id)
    : [...exploration.expanded, id]
  return { ...exploration, expanded }
}

export function pathTo(parents: Map<string, string | null>, id: string | null) {
  const path: string[] = []
  let current = id
  while (current && parents.has(current) && !path.includes(current)) {
    path.unshift(current)
    current = parents.get(current) ?? null
  }
  return path
}
