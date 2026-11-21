import Link from "next/link";
import { requireActiveProject } from "@/lib/active-project";
import { PageHeader } from "@/components/kit/page-header";
import ProteinWorkbench from "./ProteinWorkbench";
import "../orders/orders.css";

export default function ProteinPage({
  searchParams,
}: {
  searchParams: { angles?: string; pdb?: string };
}) {
  await requireActiveProject();
  const poses =
    typeof searchParams.angles === "string"
      ? searchParams.angles.split(",").map(Number)
      : [];
  const angles =
    poses.length === 2 &&
    poses.every((a) => Number.isInteger(a) && Math.abs(a) <= 180)
      ? poses
      : undefined;
  return (
    <main className="wo">
      <nav className="flex flex-wrap gap-5">
        <Link href="/lab-room">← ห้องแล็บ 3D</Link>
        <Link href="/lab-room/orders">ใบงาน Agent</Link>
      </nav>
      <PageHeader title="โต๊ะโปรตีน 3D" className="my-5" />
      <ProteinWorkbench
        initialAngles={angles}
        initialModel={searchParams.pdb}
      />
    </main>
  );
}
