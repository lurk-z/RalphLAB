/**
 * Ralph Lab agent demo · event model and pure reducer.
 *
 * Every screen (chat, 3D room, vial, Nodes) reads the same `LabDemoState`, built only from
 * these events. The reducer is idempotent: the same event delivered twice, a retried handoff,
 * or a late failure after acceptance never creates a second handoff, task, acceptance,
 * vial or formula node.
 *
 * Demo data only. This state never touches live assessment records (see lib/lab-station).
 */

import { demoJobTitle } from "./intent.ts";

import type { ChatAssessment } from "./chat-assessment.ts";
import { scopeKeyOf, type Approver, type Endpoint, type ResearchQuestion, type ResearchScope, type Scenario, type SourceRecord } from "./research.ts";

export type AgentRole = "director" | "researcher" | "formulator" | "analyst" | "evaluator";

/** Who the state belongs to. Stored and keyed above the lifetime of any view. */
export type DemoScope = { userId: string; projectId: string; mode: "demo" };

export const scopeKey = (scope: DemoScope) => `${scope.mode}|${scope.userId}|${scope.projectId}`;

type Base = {
  eventId: string;
  sequence: number;
  projectId: string;
  experimentId: string;
  threadId: string;
  source: "demo";
  occurredAt?: number;
};

export type LabEvent =
  | (Base & { type: "task.started"; jobId: string; taskId: string; owner: AgentRole; title: string; sourceMessageId: string; messageId: string })
  | (Base & { type: "message.user"; messageId: string; to: AgentRole; text: string; answerTo?: string; jobId?: string })
  | (Base & { type: "message.agent"; messageId: string; from: AgentRole; inReplyTo: string; text: string; jobId?: string; clarification?: boolean; activity?: string; assessment?: ChatAssessment })
  | (Base & { type: "job.group_requested"; jobId: string; taskId: string; messageId: string })
  | (Base & { type: "job.group_declined"; jobId: string })
  | (Base & {
      type: "handoff.sent";
      /** The user's job this handoff belongs to (one job can span several handoffs). */
      jobId: string;
      handoffId: string;
      taskId: string;
      from: AgentRole;
      to: AgentRole;
      title: string;
      sourceMessageId: string;
      stage?: string;
      jobTitle?: string;
      attempt: number;
    })
  | (Base & { type: "handoff.attempt_failed"; handoffId: string; attempt: number; reason: "ack-lost" | "unreachable" })
  | (Base & { type: "handoff.gave_up"; handoffId: string; attempt: number })
  | (Base & {
      type: "handoff.accepted";
      handoffId: string;
      taskId: string;
      by: AgentRole;
      receiptId: string;
      attempt: number;
      messageId: string;
      text: string;
    })
  /**
   * The user accepted the Researcher's invitation. The origin thread keeps a pointer to the group.
   */
  | (Base & {
      type: "job.promoted";
      jobId: string;
      originThreadId: string;
      groupThreadId: string;
      assignees: AgentRole[];
      pointerMessageId: string;
      introMessageId: string;
      targetMessageId: string;
    })
  /** The owner lays out the observable steps of an accepted task (once). */
  | (Base & { type: "task.planned"; taskId: string; steps: { stepId: string; label: string }[] })
  /** One step changes state. `done` is final; `waiting` carries what the step waits for. */
  | (Base & { type: "task.step"; taskId: string; stepId: string; status: "active" | "waiting" | "done"; note?: string })
  | (Base & { type: "task.completed"; taskId: string; summary: string; assessment?: ChatAssessment })
  /** A demo run starts: its scenario and the sources the project already holds. */
  | (Base & { type: "run.configured"; scenario: Scenario; sources: SourceRecord[] })
  /** Local sources were not enough: ask the project owner before searching outside the project. */
  | (Base & {
      type: "research.requested";
      requestId: string;
      jobId: string;
      taskId: string;
      by: AgentRole;
      question: ResearchQuestion;
      query: string;
      limit: number;
      /** Why the available sources do not answer the question (shown as the chat message). */
      gap: string;
      /** Sources checked inside the project before asking. */
      checked: string[];
      messageId: string;
    })
  /** The owner edited the draft query. It still needs explicit approval. */
  | (Base & { type: "research.query_edited"; requestId: string; query: string })
  /** The owner's answer, bound to the exact scope shown. */
  | (Base & { type: "research.decided"; requestId: string; decision: "approve" | "use-existing"; approver: Approver; scope: ResearchScope })
  | (Base & { type: "research.search_started"; requestId: string; attempt: number })
  /** Transport failure (not a scientific outcome); the same approved scope can be retried. */
  | (Base & { type: "research.search_failed"; requestId: string; attempt: number; reason: "unreachable" | "interrupted" })
  | (Base & { type: "research.search_completed"; requestId: string; attempt: number; results: SourceRecord[] })
  /** One recorded fact about a source, a question or a formula version. */
  | (Base & { type: "evidence.fact"; fact: EvidenceFact });

/**
 * Separate facts, never inferred from one another: finding a document, handing it over,
 * reviewing it and using it for a formula version are recorded one by one.
 */
export type EvidenceFact =
  | { kind: "consulted"; sourceId: string; by: AgentRole; taskId: string; relevant: boolean; reason: string }
  | { kind: "found"; sourceId: string; by: AgentRole; requestId: string }
  | { kind: "passage"; sourceId: string; by: AgentRole; taskId: string; requestId?: string; passage: string }
  | { kind: "excluded"; sourceId: string; by: AgentRole; requestId: string; reason: string }
  | { kind: "handed"; sourceId: string; from: AgentRole; to: AgentRole; handoffId: string }
  | { kind: "reviewed"; sourceId: string; by: AgentRole; versionId: string; note: string }
  | { kind: "used"; sourceId: string; by: AgentRole; versionId: string; reason: string }
  | { kind: "insufficient"; by: AgentRole; versionId: string; endpoint: Endpoint; requestId?: string; reason: string };

export type RecordedFact = EvidenceFact & { factId: string; eventId: string; sequence: number };

export function factId(fact: EvidenceFact) {
  switch (fact.kind) {
    case "consulted": return `consulted|${fact.sourceId}|${fact.taskId}`;
    case "found": return `found|${fact.sourceId}|${fact.requestId}`;
    case "passage": return `passage|${fact.sourceId}|${fact.taskId}`;
    case "excluded": return `excluded|${fact.sourceId}|${fact.requestId}`;
    case "handed": return `handed|${fact.sourceId}|${fact.handoffId}`;
    case "reviewed": return `reviewed|${fact.sourceId}|${fact.versionId}`;
    case "used": return `used|${fact.sourceId}|${fact.versionId}`;
    case "insufficient": return `insufficient|${fact.versionId}|${fact.endpoint}`;
  }
}

export type ResearchStatus = "pending" | "approved" | "searching" | "failed" | "completed" | "closed";

export type ResearchRequest = {
  requestId: string;
  jobId: string;
  taskId: string;
  threadId: string;
  messageId: string;
  experimentId: string;
  by: AgentRole;
  question: ResearchQuestion;
  query: string;
  limit: number;
  gap: string;
  checked: string[];
  status: ResearchStatus;
  decision?: { decision: "approve" | "use-existing"; approver: Approver; scope: ResearchScope; eventId: string };
  /** Search attempts made under the approved scope (retries keep the same scope). */
  attempts: number;
  searches: { attempt: number; status: "running" | "failed" | "completed"; reason?: string; resultIds?: string[] }[];
  /** found: the search returned documents · no-evidence: it returned none · use-existing: the owner declined. */
  outcome?: "found" | "no-evidence" | "use-existing";
};

/** The scope a request shows right now (what an approval must match). */
export function currentScope(projectId: string, request: ResearchRequest): ResearchScope {
  return { projectId, requestId: request.requestId, ingredient: request.question.ingredient, endpoint: request.question.endpoint,
    versionId: request.question.versionId, limit: request.limit, query: request.query };
}

export type HandoffStatus = "sending" | "retrying" | "failed" | "accepted";

export type Handoff = {
  jobId: string;
  handoffId: string;
  taskId: string;
  experimentId: string;
  threadId: string;
  from: AgentRole;
  to: AgentRole;
  title: string;
  sourceMessageId: string;
  stage?: string;
  status: HandoffStatus;
  /** Highest attempt seen so far (1 = first try). */
  attempts: number;
  receiptId?: string;
  recipientThreadId?: string;
};

export type StepStatus = "pending" | "active" | "waiting" | "done";
export type TaskStep = { stepId: string; label: string; status: StepStatus; note?: string };

export type Task = {
  taskId: string;
  jobId: string;
  acceptedMessageId: string;
  handoffId?: string;
  experimentId: string;
  owner: AgentRole;
  title: string;
  status: "accepted" | "working" | "completed";
  /** Observable progress, shown as the checklist under the owner's acceptance message. */
  steps: TaskStep[];
  summary?: string;
  workThreadId?: string;
};

/** Who is responsible for a user's job, and where the job is being discussed now. */
export type Job = {
  jobId: string;
  title: string;
  experimentId: string;
  originThreadId: string;
  /** The current owner's private thread, or the approved project group. */
  threadId: string;
  /** Distinct agents who took responsibility (the starting agent, then each acceptance). */
  assignees: AgentRole[];
  promoted: boolean;
  invitation?: { taskId: string; threadId: string; status: "pending" | "accepted" | "declined" };
};

export type ChatMessage =
  | { kind: "user"; messageId: string; threadId: string; to: AgentRole; text: string; sequence: number; answerTo?: string; jobId?: string }
  | { kind: "agent"; messageId: string; threadId: string; from: AgentRole; text: string; sequence: number; jobId?: string; taskId?: string; inReplyTo?: string; clarification?: boolean; activity?: string; assessment?: ChatAssessment }
  | { kind: "group-invite"; messageId: string; threadId: string; from: AgentRole; jobId: string; text: string; sequence: number }
  /** The sender's "A → B · title · D01" line. Its status is read from `handoffs[handoffId]`. */
  | { kind: "handoff"; messageId: string; threadId: string; handoffId: string; sequence: number }
  | { kind: "acceptance"; messageId: string; threadId: string; handoffId: string; from: AgentRole; text: string; sequence: number }
  /** Left in the origin thread when its job moves to the group. */
  | { kind: "pointer"; messageId: string; threadId: string; jobId: string; experimentId: string; targetThreadId: string; targetMessageId: string; sequence: number }
  /** First group message of a promoted job: where it came from and who is responsible. */
  | { kind: "job-intro"; messageId: string; threadId: string; jobId: string; experimentId: string; fromThreadId: string; assignees: AgentRole[]; sequence: number }
  /** An agent asks the owner to approve a search. Its live state is read from `research[requestId]`. */
  | { kind: "research"; messageId: string; threadId: string; from: AgentRole; requestId: string; jobId: string; text: string; sequence: number };

/** `private`: one agent's thread with the user (a second assignee may join). `group`: one per project. */
export type Thread = { threadId: string; kind: "private" | "group"; experimentId: string; participants: AgentRole[] };

export type LabDemoState = {
  projectId: string;
  /** Applied event ids, for redelivery. */
  seen: string[];
  /** Events in the order they were applied (rejected duplicates are not listed). */
  log: LabEvent[];
  messages: ChatMessage[];
  threads: Record<string, Thread>;
  handoffs: Record<string, Handoff>;
  tasks: Record<string, Task>;
  jobs: Record<string, Job>;
  /** Vials and formula nodes arrive in later milestones; kept here so counts are observable now. */
  vials: Record<string, never>;
  formulaNodes: Record<string, never>;
  /** The demo configuration of this run (set once per run). */
  scenario?: Scenario;
  /** Every source in the project, once each: baseline, discovered and hypotheses. */
  sources: Record<string, SourceRecord>;
  research: Record<string, ResearchRequest>;
  facts: Record<string, RecordedFact>;
};

export function initialState(projectId: string): LabDemoState {
  return { projectId, seen: [], log: [], messages: [], threads: {}, handoffs: {}, tasks: {}, jobs: {}, vials: {}, formulaNodes: {}, sources: {}, research: {}, facts: {} };
}

export const groupThreadId = (projectId: string) => `${projectId}:group`;

function withParticipant(state: LabDemoState, threadId: string, experimentId: string, role: AgentRole) {
  const kind = threadId === groupThreadId(state.projectId) ? "group" : "private";
  const thread = state.threads[threadId] ?? { threadId, kind, experimentId, participants: [] };
  if (thread.participants.includes(role)) return state.threads;
  return { ...state.threads, [threadId]: { ...thread, participants: [...thread.participants, role] } };
}

/** Apply one event. Returns the same object when the event changes nothing. */
export function reduce(state: LabDemoState, event: LabEvent): LabDemoState {
  if (event.projectId !== state.projectId) return state; // never cross projects
  if (state.seen.includes(event.eventId)) return state; // redelivery of the same event

  const next = applyEvent(state, event);
  if (next === state) return state;
  return { ...next, seen: [...state.seen, event.eventId], log: [...state.log, event] };
}

function applyEvent(state: LabDemoState, event: LabEvent): LabDemoState {
  switch (event.type) {
    case "task.started": {
      if (state.tasks[event.taskId] || state.jobs[event.jobId]) return state;
      const job: Job = { jobId: event.jobId, title: demoJobTitle(event.title), experimentId: event.experimentId,
        originThreadId: event.threadId, threadId: event.threadId, assignees: [event.owner], promoted: false };
      const task: Task = { taskId: event.taskId, jobId: job.jobId, acceptedMessageId: event.messageId,
        owner: event.owner, title: event.title, experimentId: event.experimentId, status: "accepted", steps: [] };
      return {
        ...state,
        jobs: { ...state.jobs, [job.jobId]: job },
        tasks: { ...state.tasks, [task.taskId]: task },
        messages: [...state.messages, { kind: "agent", messageId: event.messageId, from: event.owner,
          taskId: task.taskId, jobId: job.jobId, inReplyTo: event.sourceMessageId, text: event.title, sequence: event.sequence, threadId: event.threadId }],
      };
    }
    case "message.user":
      return {
        ...state,
        messages: [...state.messages, { kind: "user", messageId: event.messageId, threadId: event.threadId, to: event.to, text: event.text, answerTo: event.answerTo, sequence: event.sequence, jobId: event.jobId }],
        threads: withParticipant(state, event.threadId, event.experimentId, event.to),
      };

    case "message.agent":
      return {
        ...state,
        messages: [...state.messages, { kind: "agent", messageId: event.messageId, threadId: event.threadId, from: event.from, text: event.text, sequence: event.sequence, jobId: event.jobId, inReplyTo: event.inReplyTo, clarification: event.clarification, activity: event.activity, assessment: event.assessment }],
      };

    case "handoff.sent": {
      const existing = state.handoffs[event.handoffId];
      if (existing) {
        // A retry of the same handoff: bump the attempt, never a second handoff line.
        if (existing.status === "accepted" || event.attempt <= existing.attempts) return state;
        return { ...state, handoffs: { ...state.handoffs, [event.handoffId]: { ...existing, attempts: event.attempt, status: "sending" } } };
      }
      const job: Job = state.jobs[event.jobId] ?? {
        jobId: event.jobId,
        title: event.jobTitle?.trim() || demoJobTitle(event.title),
        experimentId: event.experimentId,
        originThreadId: event.threadId,
        threadId: event.threadId,
        assignees: [event.from],
        promoted: false,
      };
      const handoff: Handoff = {
        jobId: event.jobId,
        handoffId: event.handoffId,
        taskId: event.taskId,
        experimentId: event.experimentId,
        threadId: event.threadId,
        from: event.from,
        to: event.to,
        title: event.title,
        sourceMessageId: event.sourceMessageId,
        stage: event.stage,
        status: "sending",
        attempts: event.attempt,
      };
      return {
        ...state,
        handoffs: { ...state.handoffs, [event.handoffId]: handoff },
        jobs: { ...state.jobs, [event.jobId]: job },
        messages: [...state.messages, { kind: "handoff", messageId: `handoff:${event.handoffId}`, threadId: event.threadId, handoffId: event.handoffId, sequence: event.sequence }],
      };
    }

    case "handoff.attempt_failed":
    case "handoff.gave_up": {
      const existing = state.handoffs[event.handoffId];
      // A late error must not downgrade a delivered job, nor an older attempt overwrite a newer one.
      if (!existing || existing.status === "accepted" || event.attempt < existing.attempts) return state;
      const status: HandoffStatus = event.type === "handoff.gave_up" ? "failed" : "retrying";
      if (existing.status === status) return state;
      return { ...state, handoffs: { ...state.handoffs, [event.handoffId]: { ...existing, status } } };
    }

    case "handoff.accepted": {
      const existing = state.handoffs[event.handoffId];
      if (!existing || existing.status === "accepted" || existing.to !== event.by || existing.taskId !== event.taskId) return state;
      const task: Task = state.tasks[event.taskId] ?? {
        taskId: event.taskId,
        jobId: existing.jobId,
        acceptedMessageId: event.messageId,
        handoffId: event.handoffId,
        experimentId: existing.experimentId,
        owner: event.by,
        title: existing.title,
        status: "accepted",
        steps: [],
      };
      const job = state.jobs[existing.jobId];
      const threadId = event.threadId;
      const jobs = job
        ? { ...state.jobs, [job.jobId]: { ...job, threadId, assignees: job.assignees.includes(event.by) ? job.assignees : [...job.assignees, event.by] } }
        : state.jobs;
      const incoming: ChatMessage[] = threadId === existing.threadId ? [] : [{
        kind: "agent", messageId: existing.handoffId + ":delivery", jobId: existing.jobId, threadId, from: existing.from,
        text: `${existing.title}\nงาน «${job.title}»`, sequence: event.sequence,
      }];
      return {
        ...state,
        handoffs: { ...state.handoffs, [event.handoffId]: { ...existing, status: "accepted", receiptId: event.receiptId, recipientThreadId: threadId } },
        tasks: { ...state.tasks, [event.taskId]: task },
        jobs,
        messages: [
          ...state.messages,
          ...incoming,
          { kind: "acceptance", messageId: event.messageId, threadId, handoffId: event.handoffId, from: event.by, text: event.text, sequence: event.sequence },
        ],
        threads: withParticipant(state, threadId, existing.experimentId, event.by),
      };
    }

    case "task.planned": {
      const task = state.tasks[event.taskId];
      if (!task || task.steps.length > 0) return state;
      const steps = event.steps.map(({ stepId, label }) => ({ stepId, label, status: "pending" as const }));
      const receipt = state.messages.find((m) => m.messageId === task.acceptedMessageId);
      const messages: ChatMessage[] = receipt?.threadId === event.threadId ? state.messages : [...state.messages, {
        kind: "agent", messageId: task.taskId + ":work", threadId: event.threadId, jobId: task.jobId, taskId: task.taskId,
        from: task.owner, text: "เริ่มทบทวนโจทย์ที่ได้รับ", sequence: event.sequence,
      }];
      return { ...state, messages, tasks: { ...state.tasks, [task.taskId]: { ...task, steps, workThreadId: event.threadId } } };
    }

    case "task.step": {
      const task = state.tasks[event.taskId];
      const step = task?.steps.find((item) => item.stepId === event.stepId);
      // A finished step never reopens; a repeated update changes nothing.
      if (!task || !step || step.status === "done" || task.status === "completed") return state;
      if (step.status === event.status && step.note === event.note) return state;
      const steps = task.steps.map((item) => item.stepId === step.stepId
        // A finished step may say how it finished (skipped, nothing found); waiting notes do not carry over.
        ? { ...item, status: event.status, note: event.note }
        : item);
      return { ...state, tasks: { ...state.tasks, [task.taskId]: { ...task, steps, status: "working" } } };
    }

    case "task.completed": {
      const task = state.tasks[event.taskId];
      if (!task || task.status === "completed" || task.steps.some((item) => item.status !== "done")) return state;
      return { ...state, tasks: { ...state.tasks, [task.taskId]: { ...task, status: "completed", summary: event.summary } },
        messages: [...state.messages, { kind: "agent", from: task.owner, jobId: task.jobId, threadId: task.workThreadId ?? event.threadId,
          messageId: task.taskId + ":summary", text: event.summary, assessment: event.assessment, sequence: event.sequence }] };
    }

    case "job.group_requested": {
      const job = state.jobs[event.jobId];
      const task = state.tasks[event.taskId];
      if (!job || job.invitation || job.promoted || task?.jobId !== job.jobId || (task.owner !== "researcher" && task.owner !== "formulator")) return state;
      return { ...state, jobs: { ...state.jobs, [job.jobId]: { ...job, invitation: { threadId: event.threadId, taskId: task.taskId, status: "pending" } } },
        messages: [...state.messages, { kind: "group-invite", from: task.owner, jobId: job.jobId, threadId: event.threadId,
          messageId: event.messageId, sequence: event.sequence, text: `ต้องการสร้างกลุ่ม «${job.title}» เพื่อคุยงานนี้ด้วยกันไหม?` }] };
    }
    case "job.group_declined": {
      const job = state.jobs[event.jobId];
      if (job?.invitation?.status !== "pending") return state;
      return { ...state, jobs: { ...state.jobs, [job.jobId]: { ...job, invitation: { ...job.invitation, status: "declined" } } } };
    }
    case "run.configured": {
      if (state.scenario) return state;
      const sources = { ...state.sources };
      for (const source of event.sources) sources[source.sourceId] ??= source;
      return { ...state, scenario: event.scenario, sources };
    }

    case "research.requested": {
      if (state.research[event.requestId]) return state;
      const request: ResearchRequest = {
        requestId: event.requestId, jobId: event.jobId, taskId: event.taskId, threadId: event.threadId, messageId: event.messageId,
        experimentId: event.experimentId, by: event.by, question: event.question, query: event.query, limit: event.limit,
        gap: event.gap, checked: event.checked, status: "pending", attempts: 0, searches: [],
      };
      return {
        ...state,
        research: { ...state.research, [request.requestId]: request },
        messages: [...state.messages, { kind: "research", messageId: event.messageId, threadId: event.threadId, from: event.by,
          requestId: event.requestId, jobId: event.jobId, text: event.gap, sequence: event.sequence }],
      };
    }

    case "research.query_edited": {
      const request = state.research[event.requestId];
      const query = event.query.trim();
      // Only a draft that is still waiting can change; a decided scope never does.
      if (request?.status !== "pending" || !query || query === request.query) return state;
      return { ...state, research: { ...state.research, [request.requestId]: { ...request, query } } };
    }

    case "research.decided": {
      const request = state.research[event.requestId];
      // One answer per question, from the owner, for exactly the scope on screen.
      if (request?.status !== "pending" || !event.approver.owner) return state;
      if (scopeKeyOf(event.scope) !== scopeKeyOf(currentScope(state.projectId, request))) return state;
      const decision = { decision: event.decision, approver: event.approver, scope: event.scope, eventId: event.eventId };
      return { ...state, research: { ...state.research, [request.requestId]: event.decision === "approve"
        ? { ...request, status: "approved", decision }
        : { ...request, status: "closed", decision, outcome: "use-existing" } } };
    }

    case "research.search_started": {
      const request = state.research[event.requestId];
      // A search runs only under an approval, once per attempt.
      if (!request || request.decision?.decision !== "approve" || (request.status !== "approved" && request.status !== "failed")) return state;
      if (event.attempt !== request.attempts + 1) return state;
      return { ...state, research: { ...state.research, [request.requestId]: { ...request, status: "searching", attempts: event.attempt,
        searches: [...request.searches, { attempt: event.attempt, status: "running" }] } } };
    }

    case "research.search_failed":
    case "research.search_completed": {
      const request = state.research[event.requestId];
      if (request?.status !== "searching" || event.attempt !== request.attempts) return state;
      const failed = event.type === "research.search_failed";
      const searches = request.searches.map((s) => s.attempt !== event.attempt ? s : failed
        ? { ...s, status: "failed" as const, reason: event.reason }
        : { ...s, status: "completed" as const, resultIds: event.results.map((r) => r.sourceId) });
      if (failed) return { ...state, research: { ...state.research, [request.requestId]: { ...request, status: "failed", searches } } };
      // The same document found again (a retry, another question) stays one source.
      const sources = { ...state.sources };
      for (const result of event.results) sources[result.sourceId] ??= { ...result, origin: "project", foundBy: request.by, requestId: request.requestId };
      return { ...state, sources, research: { ...state.research, [request.requestId]: { ...request, status: "completed", searches,
        outcome: event.results.length ? "found" : "no-evidence" } } };
    }

    case "evidence.fact": {
      const fact = event.fact;
      const id = factId(fact);
      if (state.facts[id]) return state;
      if (fact.kind !== "insufficient" && !state.sources[fact.sourceId]) return state;
      // “Used for this version” needs an explicit review of the same source for the same version.
      if (fact.kind === "used" && !state.facts[`reviewed|${fact.sourceId}|${fact.versionId}`]) return state;
      return { ...state, facts: { ...state.facts, [id]: { ...fact, factId: id, eventId: event.eventId, sequence: event.sequence } } };
    }

    case "job.promoted": {
      const job = state.jobs[event.jobId];
      if (!job || job.promoted || job.invitation?.status !== "pending") return state;
      const group = state.threads[event.groupThreadId] ?? { threadId: event.groupThreadId, kind: "group" as const, experimentId: job.experimentId, participants: [] };
      const participants = [...group.participants, ...event.assignees.filter((role) => !group.participants.includes(role))];
      return {
        ...state,
        jobs: { ...state.jobs, [job.jobId]: { ...job, threadId: event.groupThreadId, promoted: true, invitation: { ...job.invitation, status: "accepted" } } },
        threads: { ...state.threads, [event.groupThreadId]: { ...group, participants } },
        messages: [
          ...state.messages,
          { kind: "pointer", messageId: event.pointerMessageId, threadId: job.originThreadId, jobId: job.jobId, experimentId: job.experimentId, targetThreadId: event.groupThreadId, targetMessageId: event.targetMessageId, sequence: event.sequence },
          { kind: "job-intro", messageId: event.introMessageId, threadId: event.groupThreadId, jobId: job.jobId, experimentId: job.experimentId, fromThreadId: job.originThreadId, assignees: event.assignees, sequence: event.sequence },
        ],
      };
    }
  }
}

/** Observable totals used by tests and the debug readout. */
export function counts(state: LabDemoState) {
  return {
    handoffs: Object.keys(state.handoffs).length,
    tasks: Object.keys(state.tasks).length,
    acceptances: state.messages.filter((m) => m.kind === "acceptance").length,
    handoffLines: state.messages.filter((m) => m.kind === "handoff").length,
    groupThreads: Object.values(state.threads).filter((t) => t.kind === "group").length,
    pointers: state.messages.filter((m) => m.kind === "pointer").length,
    vials: Object.keys(state.vials).length,
    formulaNodes: Object.keys(state.formulaNodes).length,
    researchRequests: Object.keys(state.research).length,
    searches: Object.values(state.research).reduce((n, r) => n + r.attempts, 0),
    sources: Object.keys(state.sources).length,
  };
}
