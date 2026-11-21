/**
 * `/lab-room` · the one URL for the room, its research graph and its lab tools.
 *
 * The query string is the room's state, so Back, reload, bookmarks and a login callback all
 * return to the same view and work context. Every context is resolved explicitly: an invalid
 * or unknown id stays invalid (with a way back to the room); it is never replaced by the last
 * study the viewer opened.
 *
 *   /lab-room                                  the room, nothing selected
 *   /lab-room?view=graph&agent=researcher      the graph, focused on a role
 *   /lab-room?demo=D01[&projectId=12]          the explicitly selected D01 simulation
 *   /lab-room?projectId=12                     a Next project (choose one of its work orders)
 *   /lab-room?project=12&order=<uuid>          one work order / protein desk of that project
 *   /lab-room?study=<id>                       a timed study (Cloud) · `study=demo-color-change` is the fixture
 *   /lab-room?table=station | table=protein    a lab tool inside the room
 */

export const ROLES = ['director', 'formulator', 'analyst', 'researcher', 'evaluator'] as const
export type RoleCode = (typeof ROLES)[number]

export type RoomView = 'room' | 'graph' | 'tools'
export type RoomTool = 'station' | 'protein'

export const DEMO_STUDY = 'D01'
export const TIMED_FIXTURE = 'demo-color-change'

export type RoomContext =
  | { kind: 'none' }
  | { kind: 'demo'; study: typeof DEMO_STUDY; projectId: number | null }
  | { kind: 'project'; projectId: number }
  | { kind: 'order'; projectId: number; orderId: string }
  | { kind: 'timed'; studyId: string; fixture: boolean }
  /** A requested id that cannot be opened. Shown as such; never swapped for another study. */
  | { kind: 'invalid'; param: string; value: string }

export type RoomState = {
  view: RoomView
  context: RoomContext
  agent: RoleCode | null
  tool: RoomTool | null
}

type Query = Record<string, string | string[] | undefined>
export type Parsed = { state: RoomState; redirect?: undefined } | { redirect: string; state?: undefined }

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const TIMED_ID = /^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|demo-color-change)$/i

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function isRole(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

function positiveId(value: string | undefined) {
  if (value === undefined || !/^\d{1,12}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function resolveContext(q: Query): RoomContext {
  const project = one(q.project)
  const order = one(q.order)
  const projectId = one(q.projectId)
  const study = one(q.study)
  const demo = one(q.demo)
  if (order !== undefined || project !== undefined) {
    const id = positiveId(project)
    if (id === null) return { kind: 'invalid', param: 'project', value: project ?? '' }
    if (order === undefined) return { kind: 'project', projectId: id }
    if (!UUID.test(order)) return { kind: 'invalid', param: 'order', value: order }
    return { kind: 'order', projectId: id, orderId: order.toLowerCase() }
  }
  if (study !== undefined) {
    if (!TIMED_ID.test(study)) return { kind: 'invalid', param: 'study', value: study }
    return { kind: 'timed', studyId: study.toLowerCase(), fixture: study.toLowerCase() === TIMED_FIXTURE }
  }
  const pid = projectId === undefined ? null : positiveId(projectId)
  if (projectId !== undefined && pid === null) return { kind: 'invalid', param: 'projectId', value: projectId }
  if (demo !== undefined) {
    if (demo.toUpperCase() !== DEMO_STUDY) return { kind: 'invalid', param: 'demo', value: demo }
    return { kind: 'demo', study: DEMO_STUDY, projectId: pid }
  }
  return pid === null ? { kind: 'none' } : { kind: 'project', projectId: pid }
}

/** Read the room state, or the canonical URL a legacy or Studio link should move to. */
export function parseRoomQuery(q: Query): Parsed {
  const tab = one(q.tab)
  // Studio's Assessment stays a separate workflow for callers that ask for it.
  if (tab === 'assess') {
    const query = new URLSearchParams({ tab: 'assess' })
    const projectId = one(q.projectId)
    if (projectId !== undefined) query.set('projectId', projectId)
    return { redirect: '/assess?' + query.toString() }
  }
  const viewParam = one(q.view)
  const view: RoomView = tab === 'graph' || tab === 'nodes' ? 'graph'
    : viewParam === 'graph' || viewParam === 'tools' ? viewParam : 'room'
  const table = one(q.table)
  const tool: RoomTool | null = table === 'station' || table === 'protein' ? table : null
  const agent = isRole(one(q.agent)) ? (one(q.agent) as RoleCode) : null
  const state: RoomState = { view, context: resolveContext(q), agent, tool }
  // Bookmarked `tab=lab|graph|nodes` links become the room's own state.
  if (tab !== undefined) return { redirect: roomHref(state) }
  return { state }
}

/** The canonical URL of a room state (what Back, reload and a login callback return to). */
export function roomHref(state: RoomState, base = '/lab-room') {
  const query = new URLSearchParams()
  if (state.view !== 'room') query.set('view', state.view)
  const c = state.context
  if (c.kind === 'demo') {
    query.set('demo', c.study)
    if (c.projectId !== null) query.set('projectId', String(c.projectId))
  } else if (c.kind === 'project') query.set('projectId', String(c.projectId))
  else if (c.kind === 'order') {
    query.set('project', String(c.projectId))
    query.set('order', c.orderId)
  } else if (c.kind === 'timed') query.set('study', c.studyId)
  else if (c.kind === 'invalid') query.set(c.param, c.value)
  if (state.tool) query.set('table', state.tool)
  if (state.agent) query.set('agent', state.agent)
  const text = query.toString()
  return text ? `${base}?${text}` : base
}

/** Change the view and keep everything that still applies (context, tool, focus). */
export function withView(state: RoomState, view: RoomView, agent: RoleCode | null = state.agent): RoomState {
  return { ...state, view, agent }
}

/** Login callback: only a room URL built from a parsed state, never an outside address. */
export function loginRedirect(state: RoomState) {
  return '/login?callbackUrl=' + encodeURIComponent(roomHref(state))
}

/** The scope a viewer's reads, graph memory and selection are keyed by. */
export function contextKey(viewer: string, context: RoomContext) {
  switch (context.kind) {
    case 'demo': return `${viewer}|demo:${context.study}|${context.projectId ?? 'standalone'}`
    case 'project': return `${viewer}|project:${context.projectId}`
    case 'order': return `${viewer}|project:${context.projectId}|order:${context.orderId}`
    case 'timed': return `${viewer}|timed:${context.studyId}`
    case 'invalid': return `${viewer}|invalid`
    case 'none': return `${viewer}|none`
  }
}

export function contextLabel(context: RoomContext) {
  switch (context.kind) {
    case 'none': return 'ยังไม่ได้เลือกงาน'
    case 'demo': return `${context.study} · ข้อมูลจำลอง`
    case 'project': return `โครงการ #${context.projectId}`
    case 'order': return `โครงการ #${context.projectId} · ใบงาน ${context.orderId.slice(0, 8)}`
    case 'timed': return context.fixture ? 'ติดตามการเปลี่ยนสี · ข้อมูลจำลอง' : `ใบงานตามเวลา ${context.studyId.slice(0, 8)}`
    case 'invalid': return 'เปิดงานนี้ไม่ได้'
  }
}
