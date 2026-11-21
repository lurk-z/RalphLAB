import type { AgentRole, ChatMessage, LabDemoState, Task } from './events.ts'

export type AgentStatus =
  | { kind: 'thinking' }
  | { kind: 'working'; label: string }
  | { kind: 'question'; threadId: string; messageId: string; label: string }

export type AgentStatuses = Partial<Record<AgentRole, AgentStatus>>

// An agent can have several private threads. Answering one never clears another.
export function pendingClarifications(messages: ChatMessage[]) {
  const open = new Map<string, Extract<ChatMessage, { kind: 'agent' }>>()
  for (const message of messages) {
    if (message.kind === 'agent' && message.clarification) open.set(message.threadId, message)
    if (message.kind === 'user' && message.answerTo && open.get(message.threadId)?.messageId === message.answerTo) {
      open.delete(message.threadId)
    }
  }
  return open
}

export function currentTaskStep(task: Task) {
  return task.steps.find(step => step.status === 'waiting' || step.status === 'active')
}

export function demoAgentStatuses(state: LabDemoState): AgentStatuses {
  const statuses: AgentStatuses = {}
  const pending = new Map<string, AgentRole>()
  for (const m of state.messages) {
    if (m.kind === 'user') pending.set(m.messageId, m.to)
    if (m.kind === 'agent' && m.inReplyTo) pending.delete(m.inReplyTo)
  }
  for (const owner of pending.values()) statuses[owner] = { kind: 'thinking' }

  for (const task of Object.values(state.tasks)) {
    if (task.status === 'completed') continue
    const step = currentTaskStep(task)
    statuses[task.owner] = { kind: 'working', label: step?.note || step?.label || (task.steps.every(s => s.status === 'done') && task.steps.length ? 'กำลังสรุปผล' : 'กำลังดำเนินงาน') }
  }
  for (const handoff of Object.values(state.handoffs)) {
    if ((handoff.status === 'sending' || handoff.status === 'retrying') && statuses[handoff.from]?.kind !== 'working') {
      statuses[handoff.from] = { kind: 'working', label: handoff.status === 'retrying' ? 'กำลังลองส่งงานอีกครั้ง' : 'กำลังส่งงาน' }
    }
  }

  const questions = [...pendingClarifications(state.messages).values(), ...state.messages.filter(
    (m): m is Extract<ChatMessage, { kind: 'group-invite' }> =>
      m.kind === 'group-invite' && state.jobs[m.jobId]?.invitation?.status === 'pending'
  )].sort((a, b) => a.sequence - b.sequence)
  for (const q of questions) {
    // Show the oldest unanswered question first, even when this agent also has a running task.
    if (statuses[q.from]?.kind !== 'question') {
      statuses[q.from] = { kind: 'question', threadId: q.threadId, messageId: q.messageId, label: q.text }
    }
  }
  return statuses
}

export function chatAgentStatuses(
  threads: { id: string; agent: AgentRole }[],
  pending: Record<string, boolean>,
  activity: Record<string, string[]>,
): AgentStatuses {
  const statuses: AgentStatuses = {}
  for (const thread of threads) {
    if (!pending[thread.id] || statuses[thread.agent]) continue
    const label = activity[thread.id]?.at(-1)
    statuses[thread.agent] = label ? { kind: 'working', label } : { kind: 'thinking' }
  }
  return statuses
}
