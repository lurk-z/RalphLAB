"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { apiErrorMessage, ApiError, http } from "@/lib/api";
import {
  isStudy,
  type Case,
  type Project,
  type Study,
  type StudyEvent,
} from "@/app/lab-room/orders/types";
import type { Protein } from "@/app/lab-room/protein/ProteinView";
import type { Role } from "../agents/workflow";

export type DeskBinding = { project: number; order: string };
type Phase = "walking" | "working" | "done";
type Step = NonNullable<StudyEvent["protein_step"]>;
type Pose = Pick<Step, "pdb" | "angles" | "rmsd">;
type Frame = { id: string; role: Role; message: string; step: Step };
type Playback = {
  study: Study | null;
  pose: Pose | null;
  queue: Frame[];
  phase: Phase | null;
  replaying: boolean;
};
const empty: Playback = {
  study: null,
  pose: null,
  queue: [],
  phase: null,
  replaying: false,
};

function frames(events: StudyEvent[], prefix = ""): Frame[] {
  return events.flatMap((e) =>
    e.protein_step
      ? [
          {
            id: prefix + e.id,
            role: e.sender as Role,
            message: e.message,
            step: e.protein_step,
          },
        ]
      : [],
  );
}

function savedPose(study: Study): Pose | null {
  return study.events.findLast((e) => e.pose)?.pose ?? null;
}

type Action =
  | { type: "snapshot"; study: Study }
  | { type: "phase"; id: string; phase: Phase }
  | { type: "replay"; run: string; prefix: string }
  | { type: "finish" }
  | { type: "reset" };

function reduce(state: Playback, action: Action): Playback {
  if (action.type === "reset") return empty;
  if (action.type === "snapshot") {
    const study = action.study;
    if (!state.study) return { ...empty, study, pose: savedPose(study) };
    const previous = state.study.events.length;
    if (study.events.length <= previous) return state;
    const fresh = frames(study.events.slice(previous));
    const queue = [...state.queue, ...fresh];
    return {
      ...state,
      study,
      queue,
      pose: state.queue.length
        ? state.pose
        : (fresh[0]?.step ?? savedPose(study)),
      replaying: fresh.length ? false : state.replaying,
      phase: state.queue.length ? state.phase : fresh.length ? "walking" : null,
    };
  }
  if (!state.study) return state;
  if (action.type === "finish")
    return {
      ...state,
      pose: savedPose(state.study),
      queue: [],
      phase: "done",
      replaying: false,
    };
  if (action.type === "replay") {
    const queue = frames(
      state.study.events.filter((e) => e.protein_step?.run_id === action.run),
      action.prefix,
    );
    return queue.length
      ? {
          ...state,
          queue,
          pose: queue[0].step,
          phase: "walking",
          replaying: true,
        }
      : state;
  }
  const current = state.queue[0];
  if (!current || current.id !== action.id) return state;
  if (action.phase === "done") {
    const queue = state.queue.slice(1);
    const next = queue[0];
    const pose = next?.step.phase === "inspect" ? next.step : current.step;
    return {
      ...state,
      queue,
      pose: !next && !state.replaying ? (savedPose(state.study) ?? pose) : pose,
      phase: next ? "walking" : "done",
    };
  }
  return {
    ...state,
    phase: action.phase,
    pose: action.phase === "working" ? current.step : state.pose,
  };
}

export function useProteinDesk(binding: DeskBinding | null, signedIn: boolean) {
  const [state, dispatch] = useReducer(reduce, empty);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [protein, setProtein] = useState<Protein | null>(null);
  const [modelError, setModelError] = useState("");
  const pendingRequest = useRef({ key: "", id: "" });
  const posting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const base = binding
    ? `/api/lab/projects/${binding.project}/orders/${binding.order}`
    : "";
  const project = binding?.project;
  useEffect(() => {
    if (!base || !signedIn) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let permissionsLoaded = false;
    async function check() {
      try {
        const [row, projects] = await Promise.all([
          http<Case>(base, { signal: ctrl.signal }),
          permissionsLoaded
            ? null
            : http<Project[]>("/api/lab/projects", { signal: ctrl.signal }),
        ]);
        if (ctrl.signal.aborted) return;
        if (!isStudy(row) || row.request.discipline !== "discovery") {
          setError("โต๊ะนี้ใช้กับใบงานค้นคว้ายาและพัฒนาสูตรตำรับ");
          dispatch({ type: "reset" });
          return;
        }
        dispatch({ type: "snapshot", study: row });
        if (projects) {
          setOwner(Boolean(projects.find((p) => p.id === project)?.owner));
          permissionsLoaded = true;
        }
        setError("");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(apiErrorMessage(e, "โหลดใบงานบนโต๊ะไม่ได้"));
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          dispatch({ type: "reset" });
          setOwner(false);
          return;
        }
      }
      if (!ctrl.signal.aborted) timer = setTimeout(check, 4500);
    }
    void check();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [base, project, signedIn, refresh]);
  const pdb =
    state.pose?.pdb ??
    state.study?.events.find((e) => e.structure)?.structure?.pdb ??
    "1EMA";
  const hasStudy = Boolean(state.study);
  useEffect(() => {
    if (!hasStudy) {
      setProtein(null);
      return;
    }
    const ctrl = new AbortController();
    setModelError("");
    http<Protein>("/api/lab/protein/" + (pdb === "3I40" ? "insulin" : "gfp"), {
      signal: ctrl.signal,
    })
      .then((p) => {
        if (!ctrl.signal.aborted) setProtein(p);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setModelError(apiErrorMessage(e, "โหลดพิกัดโปรตีนไม่ได้"));
      });
    return () => ctrl.abort();
  }, [hasStudy, pdb, refresh]);
  const table = useMemo(
    () =>
      protein && hasStudy && protein.pdb === pdb
        ? { protein, angles: state.pose?.angles ?? protein.start_angles }
        : null,
    [hasStudy, pdb, protein, state.pose],
  );
  const active = state.queue[0];
  const modelReady = Boolean(table);
  const work = useMemo(
    () => (modelReady && active ? { id: active.id, role: active.role } : null),
    [modelReady, active],
  );
  const phase = useCallback(
    (id: string, p: Phase) => dispatch({ type: "phase", id, phase: p }),
    [],
  );
  const [commandError, setCommandError] = useState("");
  async function run(startFrom: "latest" | "exercise") {
    if (!table || !state.study || !owner || active || posting.current) return;
    posting.current = true;
    setPending(true);
    setCommandError("");
    const body = {
      expected_sequence: state.study.events.length,
      model: table.protein.model,
      task: "align_reference",
      start_from: startFrom,
    };
    const key = JSON.stringify(body);
    if (pendingRequest.current.key !== key)
      pendingRequest.current = { key, id: crypto.randomUUID() };
    try {
      const row = await http<Study>(base + "/protein-runs", {
        method: "POST",
        body: JSON.stringify({ ...body, id: pendingRequest.current.id }),
      });
      if (mounted.current) dispatch({ type: "snapshot", study: row });
    } catch (e) {
      if (mounted.current) {
        setCommandError(apiErrorMessage(e, "ส่งงานให้ทีมไม่ได้"));
        setRefresh((v) => v + 1);
      }
    } finally {
      posting.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const replay = (id: string) =>
    dispatch({ type: "replay", run: id, prefix: crypto.randomUUID() });
  const finish = () => dispatch({ type: "finish" });
  return {
    state,
    active,
    work,
    phase,
    table,
    owner,
    pending,
    error: error || modelError || commandError,
    run,
    replay,
    finish,
    retry: () => {
      setCommandError("");
      setRefresh((v) => v + 1);
    },
  };
}
