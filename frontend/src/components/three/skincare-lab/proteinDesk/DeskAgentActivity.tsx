import { Network, X } from "lucide-react";
import type { Study } from "@/app/lab-room/orders/types";
import { WORKBENCH_ROLE_LABEL as ROLE_LABEL } from "../agents/roles";
import type { Role } from "../agents/workflow";

export default function DeskAgentActivity({
  study,
  role,
  onClose,
  onOpenGraph,
}: {
  study: Study;
  role: Role;
  onClose: () => void;
  /** Opens this work order's graph focused on the same agent. */
  onOpenGraph?: (role: Role) => void;
}) {
  const events = study.events
    .filter((e) => e.sender === role && (e.protein_step || e.comparison_step))
    .slice()
    .reverse();
  return (
    <aside
      aria-label="งานของ Agent ที่โต๊ะโปรตีน"
      className="h-full overflow-auto border-l bg-white p-5 text-slate-800"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{ROLE_LABEL[role]}</h2>
        {onOpenGraph && <button type="button" onClick={() => onOpenGraph(role)} aria-label={`เปิดกราฟของ ${ROLE_LABEL[role]}`}
          title="กราฟการทดลอง" className="ml-auto rounded-md border p-1.5"><Network size={16} /></button>}
        <button
          type="button"
          aria-label="ปิดประวัติ Agent"
          onClick={onClose}
          className="rounded-md border p-1.5"
        >
          <X size={16} />
        </button>
      </header>
      <p className="mb-4 text-sm text-slate-600">{study.request.brief}</p>
      {events.length ? (
        <ol className="space-y-3">
          {events.map((e) => {
            if (e.comparison_step)
              return (
                <li key={e.id} className="rounded-lg border p-3 text-sm">
                  <strong>{e.message}</strong>
                  {e.comparison_step.sources.map((s) => (
                    <p className="mt-1" key={s.url}>
                      <a
                        className="text-teal-800 underline"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.title}
                      </a>{" "}
                      · {s.locator}
                    </p>
                  ))}
                </li>
              );
            const step = e.protein_step!;
            return (
              <li key={e.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{e.message}</p>
                <p className="my-1">
                  มุม {step.angles.join("°, ")}° · RMSD {step.rmsd.toFixed(3)} Å
                </p>
                <a
                  className="text-teal-800 underline"
                  href={step.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDB {step.pdb}
                </a>
                {" · "}
                <time className="text-xs text-slate-600">
                  {new Date(e.at).toLocaleString("th-TH")}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm">
          ยังไม่มีการปรับโครงสร้างที่บันทึกโดยบทบาทนี้ในใบงาน
        </p>
      )}
    </aside>
  );
}
