/**
 * Live research graph · one real work order or study from `/api/lab/projects/{id}/orders/{id}`.
 *
 * Only what the service recorded is drawn. Roles use the stable codes director / researcher /
 * formulator / analyst / evaluator (`head` is the project owner). Finding a source, handing it
 * over, its recorded review and its use for a version are separate facts: a source is “used
 * for V…” only when an owner decision approved that version with the source cited. A study
 * decision links to the study; a version edge exists only where the record names a version.
 */
import type { AgentRole } from '../lab-demo/events.ts'
import { ROLE_EN, ROLE_TH } from '../lab-demo/roles.ts'
import { agentNodeId, AGENT_ORDER, type GraphEdge, type GraphNode, type ProjectGraph } from './model.ts'

type Revision = { version: string; ingredients: { name: string; percent: string }[] }
type Source = { title: string; url: string; locator: string; principle?: string; application?: string }
type Evidence = { id: number; source: string; review: string; reference?: string; url?: string }
type LiveEvent = {
  id: string
  sequence: number
  at: string
  sender: string
  recipient: string
  message: string
  version?: string
  actor?: string
  command?: { action: string }
  citations?: { ingredient: string; record: number; evidence?: Evidence[] }[]
  changes?: { name: string; before: string; after: string; locked: boolean }[]
  sources_sent?: { title: string; url: string; locator: string }[]
  reviewed_stage?: string
  stage_id?: string
  result?: { disposition: string; finding: string; unit: string | null; literature?: Source[] }
}
export type LiveCase = {
  id: string
  project_id: number
  state: string
  events: LiveEvent[]
  request: { brief: string; kind?: 'study'; version?: string; baseline?: Revision; candidate?: Revision; endpoint?: string }
  stages?: { id: string; title: string; role: string; source: Source; status: string; application?: string }[]
  report?: { decision: string; actor: string; at: string; note: string; citations?: unknown[] } | null
}

const isRole = (value: string): value is AgentRole => (AGENT_ORDER as string[]).includes(value)
const who = (value: string) => (isRole(value) ? ROLE_EN[value] : value === 'head' ? 'เจ้าของโครงการ' : value)

export function buildCaseGraph(item: LiveCase): ProjectGraph {
  const p = `p${item.project_id}`
  const x = item.id.slice(0, 8)
  const nodes: Record<string, GraphNode> = {}
  const edges = new Map<string, GraphEdge>()
  const children: Record<string, string[]> = {}
  const recordHref = (event?: LiveEvent) =>
    `/lab-room/orders?project=${item.project_id}&order=${item.id}${event ? `#event-${event.sequence}` : ''}`

  const add = (node: Omit<GraphNode, 'facts' | 'lists' | 'eventIds' | 'demo'> & Partial<GraphNode>) =>
    (nodes[node.id] ??= { facts: [], lists: [], eventIds: [], demo: false, ...node } as GraphNode)
  const link = (source: string, target: string, verb: string, eventId?: string, decision?: GraphEdge['decision']) => {
    const id = `${source}>${verb}>${target}`
    const edge = edges.get(id) ?? { id, source, target, verb, eventIds: [], decision }
    if (eventId && !edge.eventIds.includes(eventId)) edge.eventIds.push(eventId)
    edges.set(id, edge)
  }
  const reveal = (parent: string, child: string) => {
    const list = (children[parent] ??= [])
    if (!list.includes(child)) list.push(child)
  }
  const timeline = (node: GraphNode, label: string, note?: string, link?: string) => {
    let list = node.lists.find((l) => l.title === 'ลำดับเหตุการณ์')
    if (!list) node.lists.push(list = { title: 'ลำดับเหตุการณ์', items: [] })
    list.items.push({ label, note, link })
  }

  for (const role of AGENT_ORDER) {
    add({ id: agentNodeId(p, role), kind: 'agent', label: ROLE_EN[role], role, owner: role, heading: ROLE_EN[role], summary: ROLE_TH[role] })
  }

  // The work order itself.
  const caseId = `${p}:case:${item.id}`
  const caseNode = add({ id: caseId, kind: 'study', label: item.request.kind === 'study' ? 'ใบงานวิจัย' : 'ใบงานเทียบสูตร',
    sublabel: x, heading: item.request.brief, summary: item.request.brief, recordHref: recordHref() })
  caseNode.facts.push({ label: 'สถานะ', value: item.state }, { label: 'รหัสใบงาน', value: item.id })
  link(agentNodeId(p, 'director'), caseId, 'เปิดใบงาน')
  reveal(agentNodeId(p, 'director'), caseId)

  // Formula versions: only those the order names.
  const formulaId = (version: string) => `${p}:formula:${item.id}:${version}`
  const base = item.request.baseline
  const candidate = item.request.candidate
  if (base) add({ id: formulaId(base.version), kind: 'formula', label: base.version, heading: base.version, summary: 'สูตรต้นทาง',
    lists: [{ title: 'ส่วนผสม', items: base.ingredients.map((i) => ({ label: `${i.name} ${i.percent}%` })) }] })
  if (candidate) {
    const node = add({ id: formulaId(candidate.version), kind: 'formula', label: candidate.version, heading: candidate.version, summary: 'รุ่นที่เสนอ',
      lists: [{ title: 'ส่วนผสม', items: candidate.ingredients.map((i) => ({ label: `${i.name} ${i.percent}%` })) }] })
    if (base) {
      link(formulaId(base.version), node.id, 'แตกรุ่น')
      reveal(formulaId(base.version), node.id)
      node.facts.push({ label: 'รุ่นแม่', value: base.version, link: formulaId(base.version) })
    }
  }
  for (const v of [base, candidate]) if (v) { link(caseId, formulaId(v.version), 'เทียบ'); reveal(caseId, formulaId(v.version)) }

  // Stages of a study and the role reference each one cites.
  const stageId = (id: string) => `${p}:stage:${item.id}:${id}`
  const sourceKey = (url: string, title: string) => `${p}:source:${url || title}`
  const addSource = (src: { title: string; url?: string; locator?: string }, origin: 'baseline' | 'project') => {
    const node = add({ id: sourceKey(src.url ?? '', src.title), kind: 'source', origin, label: src.title, heading: src.title,
      url: src.url || undefined, locator: src.locator || undefined })
    return node
  }
  for (const stage of item.stages ?? []) {
    const id = stageId(stage.id)
    const node = add({ id, kind: 'stage', label: stage.title, sublabel: stage.status, heading: stage.title, recordHref: recordHref() })
    node.facts.push({ label: 'สถานะ', value: stage.status })
    link(caseId, id, 'มีขั้น')
    reveal(caseId, id)
    if (isRole(stage.role)) {
      node.facts.push({ label: 'ผู้รับผิดชอบ', value: ROLE_EN[stage.role], link: agentNodeId(p, stage.role) })
      link(agentNodeId(p, stage.role), id, 'รับผิดชอบ')
      reveal(agentNodeId(p, stage.role), id)
    }
    if (stage.source?.title) {
      const src = addSource(stage.source, 'baseline')
      link(src.id, id, 'หลักการอ้างอิง')
      reveal(id, src.id)
      if (stage.source.principle) src.summary = stage.source.principle
    }
  }

  // Events: handoffs, citations, sources handed over, reviews and results.
  for (const event of item.events) {
    const eventNodeHref = recordHref(event)
    if (isRole(event.sender) && isRole(event.recipient) && event.sender !== event.recipient) {
      link(agentNodeId(p, event.sender), agentNodeId(p, event.recipient), 'ส่งงาน', event.id)
      reveal(agentNodeId(p, event.sender), agentNodeId(p, event.recipient))
    }
    for (const citation of event.citations ?? []) for (const ev of citation.evidence ?? []) {
      const src = add({ id: `${p}:source:evidence:${ev.id}`, kind: 'source', origin: 'project', label: ev.reference || ev.source,
        sublabel: citation.ingredient, heading: ev.reference || ev.source, url: ev.url || undefined, recordHref: eventNodeHref })
      if (!src.facts.length) src.facts.push({ label: 'สาร', value: citation.ingredient }, { label: 'ทบทวนไว้', value: ev.review })
      if (isRole(event.sender)) {
        link(agentNodeId(p, event.sender), src.id, 'พบ', event.id)
        reveal(agentNodeId(p, event.sender), src.id)
        timeline(src, `ค้นพบ · ${who(event.sender)}`, event.message, eventNodeHref)
      }
      if (isRole(event.recipient)) timeline(src, `ส่งต่อ · ${who(event.sender)} → ${who(event.recipient)}`)
      src.eventIds.push(event.id)
    }
    for (const sent of event.sources_sent ?? []) {
      const src = addSource(sent, 'project')
      timeline(src, `ส่งต่อ · ${who(event.sender)} → ${who(event.recipient)}`, event.message, eventNodeHref)
      if (isRole(event.sender)) { link(agentNodeId(p, event.sender), src.id, 'ส่งต่อ', event.id); reveal(agentNodeId(p, event.sender), src.id) }
    }
    if (event.reviewed_stage && isRole(event.sender)) {
      const id = stageId(event.reviewed_stage)
      if (nodes[id]) { link(agentNodeId(p, event.sender), id, 'ตรวจแล้ว', event.id); timeline(nodes[id], `ตรวจแล้ว · ${who(event.sender)}`, event.message, eventNodeHref) }
    }
    if (event.result && event.stage_id) {
      const id = stageId(event.stage_id)
      if (nodes[id]) {
        timeline(nodes[id], `บันทึกผล · ${who(event.sender)}`, event.result.finding, eventNodeHref)
        for (const lit of event.result.literature ?? []) {
          const src = addSource(lit, 'project')
          link(src.id, id, 'ใช้ประกอบขั้นนี้', event.id)
          reveal(id, src.id)
        }
      }
    }
  }

  // The owner's decision: on the study, and on a version only when one was approved with its citations.
  if (item.report) {
    const id = `${p}:decision:${item.id}`
    add({ id, kind: 'decision', label: `ข้อสรุป · ${item.report.decision}`, heading: 'คำตัดสินของเจ้าของโครงการ', summary: item.report.note,
      facts: [{ label: 'ผล', value: item.report.decision }, { label: 'เมื่อ', value: item.report.at }], lists: [], eventIds: [] })
    link(caseId, id, 'ตัดสิน')
    reveal(caseId, id)
    if (candidate && item.report.decision === 'approved') {
      for (const node of Object.values(nodes)) if (node.kind === 'source' && node.id.includes(':source:evidence:')) {
        link(node.id, formulaId(candidate.version), `ใช้กับ ${candidate.version}`)
        reveal(node.id, formulaId(candidate.version))
        timeline(node, `ใช้กับ ${candidate.version} · เจ้าของโครงการอนุมัติ`)
      }
    }
  }

  return { projectId: p, experimentId: x, nodes, edges: [...edges.values()], children, recordedHandoffs: item.events.length }
}

/** Whether a live graph has anything beyond its agents (sources, decisions, stages, versions). */
export function hasRecords(graph: ProjectGraph) {
  return Object.values(graph.nodes).some((n) => n.kind === 'source' || n.kind === 'decision' || n.kind === 'stage' || n.kind === 'formula')
}
