import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoStore, createLabDemo, createMockTransport, DEMO_PLAYBOOK } from '../src/lib/lab-demo/engine.ts'
import { chatAgentStatuses, demoAgentStatuses } from '../src/lib/lab-demo/agent-status.ts'

function lab() {
  const store = createDemoStore()
  const scope = { userId: 'guest', projectId: 'lab', mode: 'demo' as const }
  const demo = createLabDemo({ store, scope, experimentId: 'D01', transport: createMockTransport({}), playbook: DEMO_PLAYBOOK })
  return { ...demo, statuses: () => demoAgentStatuses(store.get(scope)) }
}

test('a pending reply, a clarification and an active step follow their own agent and conversation', async () => {
  const demo = lab()
  const thread = 'lab:D01:private:analyst:first'
  const other = 'lab:D01:private:analyst:second'
  assert.deepEqual(demo.statuses(), {})
  const request = demo.submit('analyst', 'สวัสดี', thread)
  assert.deepEqual(demo.statuses().analyst, { kind: 'thinking' })
  await request
  const badge = demo.statuses().analyst
  assert.ok(badge?.kind === 'question')
  assert.equal(badge.threadId, thread)
  assert.ok(demo.state().messages.some(m => m.messageId === badge.messageId && m.threadId === thread))

  await demo.submit('analyst', 'ดูผล V1', other)
  assert.deepEqual(demo.statuses().analyst, badge)
  const work = demo.submit('formulator', 'ปรับสัดส่วน V1')
  assert.deepEqual(demo.statuses().formulator, { kind: 'working', label: 'อ่านสูตรตัวอย่าง V1' })
  assert.deepEqual(demo.statuses().analyst, badge)
  await work
  await demo.idle()
  await demo.submit('analyst', 'ดูข้อมูลที่มีอยู่', thread)
  assert.deepEqual(demo.statuses(), {})
})

test('two invitations for the same agent open their exact private messages until each decision is recorded', async () => {
  const demo = lab()
  const first = await demo.submit('director', 'เปิดโครงการสูตร A')
  const second = await demo.submit('director', 'เปิดโครงการสูตร B')
  await demo.idle()
  const firstBadge = demo.statuses().formulator
  assert.ok(firstBadge?.kind === 'question')
  assert.equal(firstBadge.threadId, demo.state().jobs[first.jobId!].invitation?.threadId)
  assert.deepEqual(demo.statuses().formulator, firstBadge)
  demo.decideGroup(first.jobId!, false)
  const secondBadge = demo.statuses().formulator
  assert.ok(secondBadge?.kind === 'question')
  assert.notEqual(firstBadge.messageId, secondBadge.messageId)
  assert.equal(secondBadge.threadId, demo.state().jobs[second.jobId!].invitation?.threadId)
  demo.decideGroup(second.jobId!, true)
  await demo.idle()
  assert.deepEqual(demo.statuses(), {})
})

test('API labels exist only while that thread is pending and use the latest public activity', () => {
  const threads = [{ id: 'a', agent: 'analyst' as const }, { id: 'b', agent: 'director' as const }]
  assert.deepEqual(chatAgentStatuses(threads, { a: true, b: true }, { b: ['ตรวจโจทย์', 'สรุปผล'] }), {
    analyst: { kind: 'thinking' }, director: { kind: 'working', label: 'สรุปผล' },
  })
  assert.deepEqual(chatAgentStatuses(threads, { a: false }, { a: ['ขั้นตอนเก่า'] }), {})
})
