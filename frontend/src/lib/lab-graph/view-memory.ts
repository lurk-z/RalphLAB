/**
 * Per-project view state kept at module level, above the lifetime of the Lab and Graph tabs.
 * Switching tabs unmounts each view; this is how each one comes back where the user left it.
 * It holds no records: nothing here is written to the project, its formulas or assessments.
 */
import type { AgentRole } from '../lab-demo/events.ts'
import type { DemoScreen } from '../lab-demo/conversations.ts'
import type { Point } from './layout.ts'
import { emptyExploration, type Exploration, type MessageRef } from './model.ts'

export const viewKey = (projectId: number | null) => projectId == null ? 'standalone' : `p${projectId}`

type GraphView = { exploration: Exploration; positions: Record<string, Point> }
const graphs = new Map<string, GraphView>()

export function loadGraphView(key: string): GraphView {
  return graphs.get(key) ?? { exploration: emptyExploration(), positions: {} }
}
export function saveGraphView(key: string, view: GraphView) {
  graphs.set(key, view)
}

export type LabScreen = { agent: AgentRole | null; screen: DemoScreen }
const labs = new Map<string, LabScreen>()

export function loadLabScreen(key: string): LabScreen | undefined {
  return labs.get(key)
}
export function saveLabScreen(key: string, value: LabScreen) {
  const current = labs.get(key)
  let screen = value.screen
  // A one-off highlight is not restored twice.
  if (screen.kind !== 'inbox' && screen.highlightId) screen = { ...screen, highlightId: undefined }
  // Keep the history thread the open chat reported for the same agent.
  if (screen.kind === 'private' && !screen.threadId && current?.agent === value.agent && current.screen.kind === 'private')
    screen = { ...screen, threadId: current.screen.threadId }
  labs.set(key, { agent: value.agent, screen })
}
/** Remember which history thread the open private chat shows, without remounting it. */
export function saveReadingThread(key: string, agent: AgentRole, threadId: string) {
  const current = labs.get(key)
  if (current?.agent !== agent || current.screen.kind !== 'private') return
  labs.set(key, { agent, screen: { kind: 'private', threadId } })
}
/** Open Lab at one recorded message (from the graph's “เปิดข้อความต้นทาง”). */
export function openLabAtMessage(key: string, ref: MessageRef) {
  labs.set(key, {
    agent: ref.agent,
    screen: ref.group && ref.jobId
      ? { kind: 'group', jobId: ref.jobId, highlightId: ref.messageId }
      : { kind: 'private', threadId: ref.threadId, highlightId: ref.messageId },
  })
}
