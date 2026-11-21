import { requireActiveProject } from "@/lib/active-project";

export default async function LabLayout({children}: {children: React.ReactNode}) {
  await requireActiveProject();
  return children;
}
