'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { useSession } from 'next-auth/react'
import { createDemoStore, createLabDemo, createMockTransport, DEMO_PLAYBOOK, type DemoPersistence, type Fault } from '@/lib/lab-demo/engine'
import { counts, currentScope, scopeKey, type DemoScope, type LabEvent } from '@/lib/lab-demo/events'
import { createChatArchive, emptyHistory } from '@/lib/lab-demo/chat-history'
import { createMockSearchAdapter, DEFAULT_SCENARIO, type Approver, type ResearchScope, type Scenario } from '@/lib/lab-demo/research'
import { STUDY_BRIEF } from '@/lib/lab-demo/study-example'

/**
 * Agent demo · deterministic, demo data only.
 *
 * The store and the engines live at module level, above the lifetime of the Lab tab and
 * the chat panel: closing the chat or switching to Graph mid-handoff never strands or
 * repeats a delivery. Each user + project keeps its event history in this browser, so a
 * refresh restores the run (a pending approval, a finished search) without redoing anything.
 *
 * `?demoFault=ack-lost`  → the Director accepts, but the first acknowledgement is lost.
 * `?demoFault=fail-twice` → both automatic attempts fail; the message offers a manual retry.
 */
export const DEMO_EXPERIMENT = 'D01'
export { STUDY_BRIEF }
const LATENCY_MS = 900
const STEP_MS = 900
const SEARCH_LATENCY_MS = 1200
const EVENTS_KEY = 'ralphlab:lab-demo-events:v1:'

function storage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

const persistence: DemoPersistence = {
  load(scope) {
    try {
      const value = JSON.parse(storage()?.getItem(EVENTS_KEY + scopeKey(scope)) || '[]')
      return Array.isArray(value) ? value.filter((e): e is LabEvent =>
        typeof e?.type === 'string' && typeof e.eventId === 'string' && Number.isInteger(e.sequence)) : []
    } catch { return [] }
  },
  save(scope, events) {
    try { storage()?.setItem(EVENTS_KEY + scopeKey(scope), JSON.stringify(events)) } catch { /* Kept in memory until reload. */ }
  },
  clear(scope) {
    try { storage()?.removeItem(EVENTS_KEY + scopeKey(scope)) } catch { /* Storage is optional. */ }
  },
}

const archive = createChatArchive(() => window.localStorage, Math.random().toString(36).slice(2))
const store = createDemoStore(archive.append, persistence)
const engines = new Map<string, ReturnType<typeof createLabDemo>>()
/** Fast-forward engines (Graph's “record the study”), stopped when their run is reset. */
const helpers = new Map<string, ReturnType<typeof createLabDemo>[]>()
/** One mock search adapter per scope. It never touches the network and counts its calls. */
const adapters = new Map<string, ReturnType<typeof createMockSearchAdapter>>()

function faultsFromUrl(): Fault[] {
  const value = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('demoFault')
  if (value === 'ack-lost') return [{ attempt: 1, kind: 'ack-lost' }]
  if (value === 'fail-twice') return [{ attempt: 1, kind: 'unreachable' }, { attempt: 2, kind: 'ack-lost' }]
  return []
}

export function demoScope(projectId: number | null, userId: string): DemoScope {
  return { userId, projectId: projectId == null ? 'standalone' : `p${projectId}`, mode: 'demo' }
}

function adapterFor(scope: DemoScope) {
  const key = scopeKey(scope)
  let adapter = adapters.get(key)
  if (!adapter) {
    adapter = createMockSearchAdapter({ latencyMs: SEARCH_LATENCY_MS })
    adapters.set(key, adapter)
  }
  return adapter
}

function engineFor(scope: DemoScope) {
  const key = scopeKey(scope)
  let engine = engines.get(key)
  if (!engine) {
    engine = createLabDemo({ store, scope, experimentId: DEMO_EXPERIMENT, transport: createMockTransport({ faults: faultsFromUrl(), latencyMs: LATENCY_MS }),
      playbook: DEMO_PLAYBOOK, stepMs: STEP_MS, search: adapterFor(scope) })
    engines.set(key, engine)
  }
  return engine
}

/**
 * Record the scripted D01 study without the on-screen pacing: the same engine, playbook and
 * events as typing the brief to the Study Lead and accepting the group. It stops where the
 * owner has to decide (the Curator's search request) and never answers for them.
 */
async function recordStudy(scope: DemoScope) {
  const engine = createLabDemo({ store, scope, experimentId: DEMO_EXPERIMENT, transport: createMockTransport(), playbook: DEMO_PLAYBOOK, search: adapterFor(scope) })
  const key = scopeKey(scope)
  helpers.set(key, [...(helpers.get(key) ?? []), engine])
  const { jobId } = await engine.submit('director', STUDY_BRIEF)
  await engine.idle()
  if (jobId) engine.decideGroup(jobId, true)
  await engine.idle()
}

/** Start a fresh test run for this user and project only. */
function resetRun(scope: DemoScope) {
  const key = scopeKey(scope)
  engines.get(key)?.dispose()
  for (const helper of helpers.get(key) ?? []) helper.dispose()
  engines.delete(key)
  helpers.delete(key)
  adapters.delete(key)
  store.reset(scope)
  archive.clear(scope)
}

const noCalls = () => () => {}

export function useAgentDemo(projectId: number | null) {
  const { data, status } = useSession()
  const viewer = data?.user
  const scope = demoScope(projectId, viewer?.id || viewer?.email || 'demo-user')
  const state = useSyncExternalStore(store.subscribe, () => store.get(scope), () => store.get(scope))
  const rawHistory = useSyncExternalStore(archive.subscribe, () => archive.load(scope), () => emptyHistory)
  const engine = engineFor(scope)
  const adapter = adapterFor(scope)
  const adapterCalls = useSyncExternalStore(adapter?.subscribe ?? noCalls, () => adapter.calls.length, () => 0)
  // A restored history already shows these messages; the archive copy would repeat them.
  const history = useMemo(() => {
    const restored = new Set(state.messages.map((m) => m.messageId))
    const original = (id: string) => id.slice(id.indexOf(':') + 1)
    return { ...rawHistory, previousSession: rawHistory.previousSession.map((row) => ({
      ...row, messages: row.messages.filter((m) => !restored.has(original(m.id))),
    })).filter((row) => row.messages.length) }
  }, [rawHistory, state.messages])
  // A project opens only for its owner (the API returns it to no one else), so the signed-in
  // viewer is the approver there. The standalone preview has an explicitly simulated owner.
  const approver: Approver = projectId == null
    ? { id: 'simulated-owner', label: 'เจ้าของโครงการจำลอง', owner: true, simulated: true }
    : { id: scope.userId, label: viewer?.name || viewer?.email || 'เจ้าของโครงการ', owner: true, simulated: false }
  const started = Object.keys(state.jobs).length > 0
  return { state, submit: engine.submit, submitGroup: engine.submitGroup, decideGroup: engine.decideGroup, retry: engine.retry,
    history, deleteThread: (id: string) => archive.remove(scope, id), recordStudy: () => recordStudy(scope),
    viewer, ready: status !== 'loading', userId: scope.userId, experimentId: DEMO_EXPERIMENT,
    approver,
    /** Logical searches recorded in this run, and adapter invocations since this page loaded. */
    searches: counts(state).searches, adapterCalls,
    scenario: state.scenario, started,
    /** The scope the card showed when the owner clicked; anything else is refused. */
    approveResearch: (requestId: string, shown: ResearchScope) => engine.decideResearch(requestId, 'approve', approver, shown),
    useExistingData: (requestId: string, shown: ResearchScope) => engine.decideResearch(requestId, 'use-existing', approver, shown),
    scopeOf: (requestId: string) => {
      const request = store.get(scope).research[requestId]
      return request ? currentScope(scope.projectId, request) : undefined
    },
    editResearchQuery: engine.editResearchQuery,
    retryResearch: engine.retryResearch,
    /** The Lab demo entry: pick the scenario for this run and send the D01 brief to the Study Lead. */
    startResearchDemo: async (scenario: Scenario = DEFAULT_SCENARIO) => {
      engine.configure(scenario)
      if (Object.keys(store.get(scope).jobs).length) return
      await engine.submit('director', STUDY_BRIEF)
    },
    resetRun: () => resetRun(scope),
    /**
     * Continue deliveries and steps a reload cut off. Only the Lab calls this: opening Graph
     * never advances the experiment, and nothing here answers an approval.
     */
    resume: engine.resume,
    scopeKey: scopeKey(scope),
  }
}

export type AgentDemo = ReturnType<typeof useAgentDemo>
