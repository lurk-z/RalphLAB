/**
 * A timed study as a graph: its plan, each observation round (measured, pending or missed),
 * the reported problem and the owner's decision. The decision links to the study; a timed
 * study names no formula version, so no version edge is drawn.
 */
import { ROLE_EN, ROLE_TH } from '../lab-demo/roles.ts'
import { AGENT_ORDER, agentNodeId, type GraphEdge, type GraphNode, type ProjectGraph } from './model.ts'
import { STATE_TH, timedReport, type TimedRow } from '../lab-room/timed.ts'

const stamp = (ms: number) => new Date(ms).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

export function buildTimedGraph(row: TimedRow, demo: boolean, now: number): ProjectGraph {
  const p = `timed:${row.id}`
  const nodes: Record<string, GraphNode> = {}
  const edges: GraphEdge[] = []
  const children: Record<string, string[]> = {}
  const add = (node: Partial<GraphNode> & Pick<GraphNode, 'id' | 'kind' | 'label' | 'heading'>) =>
    (nodes[node.id] = { facts: [], lists: [], eventIds: [], demo, ...node } as GraphNode)
  const link = (source: string, target: string, verb: string) => {
    edges.push({ id: `${source}>${verb}>${target}`, source, target, verb, eventIds: [] })
    ;(children[source] ??= []).push(target)
    ;(children[target] ??= []).push(source)
  }
  for (const role of AGENT_ORDER) add({ id: agentNodeId(p, role), kind: 'agent', label: ROLE_EN[role], role, owner: role, heading: ROLE_EN[role], summary: ROLE_TH[role] })

  const study = add({ id: `${p}:study`, kind: 'study', label: row.brief, sublabel: STATE_TH[row.state], heading: row.brief, summary: row.goal,
    facts: [
      { label: 'ตัวชี้วัด', value: `${row.metric} (${row.unit})` },
      { label: 'เงื่อนไข', value: row.condition },
      { label: 'เกณฑ์พักงาน', value: row.exception },
      { label: 'สถานะ', value: STATE_TH[row.state] },
      ...(demo ? [{ label: 'ประเภทข้อมูล', value: 'ข้อมูลจำลอง' }] : []),
    ] })
  link(agentNodeId(p, 'director'), study.id, 'วางแผนรอบวัด')

  for (const round of row.rounds) {
    const r = round.result
    const missed = !r && round.due <= now
    const id = `${p}:round:${round.hour}`
    const node = add({ id, kind: 'stage', label: `รอบ ${Math.round(round.hour * 10) / 10} ชม.`,
      sublabel: r ? `${r.value} ${row.unit}` : missed ? 'ถึงรอบแล้ว · ยังไม่มีค่า' : 'รอวัด', heading: `รอบ ${round.hour} ชั่วโมง`,
      facts: [
        { label: 'นัดวัด', value: stamp(round.due) },
        { label: 'วัดจริง', value: r ? stamp(r.observed) : '—' },
        { label: 'ค่า', value: r ? `${r.value} ${row.unit}` : missed ? 'ยังไม่มีค่า' : 'รอวัด' },
        ...(round.followup ? [{ label: 'รอบเพิ่ม', value: round.followup }] : []),
      ] })
    link(study.id, id, 'มีรอบ')
    if (r) {
      link(agentNodeId(p, 'analyst'), id, 'บันทึกค่า')
      const src = add({ id: `${id}:evidence`, kind: 'source', origin: 'project', label: 'หลักฐานรอบนี้', heading: r.source, summary: r.note,
        facts: [{ label: 'หลักฐาน', value: r.source }] })
      link(src.id, node.id, 'เป็นหลักฐาน')
    }
  }

  if (row.problem) {
    const issue = add({ id: `${p}:issue`, kind: 'research', status: row.state === 'paused' ? 'pending' : 'approved', label: 'ปัญหาที่รายงาน',
      sublabel: row.state === 'paused' ? 'รอเจ้าของตัดสินใจ' : 'ตอบแล้ว', heading: 'ปัญหาที่รายงาน', summary: row.problem })
    link(agentNodeId(p, 'evaluator'), issue.id, 'พบปัญหา')
    link(issue.id, study.id, 'พักงาน')
  }
  row.notes.filter((n) => n.action !== 'issue').forEach((note, i) => {
    const id = `${p}:decision:${i}`
    add({ id, kind: 'decision', label: `คำตัดสิน · ${note.action}`, sublabel: `ผ่าน ${note.via}`, heading: 'คำตัดสินของเจ้าของ', summary: note.note,
      facts: [{ label: 'ช่องทาง', value: note.via }, { label: 'เมื่อ', value: stamp(note.at) }] })
    link(id, study.id, 'ตัดสิน')
  })
  const report = timedReport(row)
  study.facts.push({ label: 'วัดแล้ว', value: `${report.count}/${report.total} รอบ` },
    { label: 'ค่าล่าสุด', value: report.last === null ? '—' : `${report.last} ${row.unit}` })

  return { projectId: p, experimentId: row.brief, nodes, edges, children, recordedHandoffs: row.notes.length }
}
