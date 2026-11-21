import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { loginEnabled } from "./login-mode";
import { parseProjectRouteId } from "./project-routing";

export const projectCookie = "ralphlab-project";
export const currentSession = cache(() => getServerSession(authOptions));

export const projectAccess = cache(async (id: number) => {
  const token = (await currentSession())?.backendToken;
  if (!token) return 401;
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(api + "/api/projects/" + id, {
    headers: {Authorization: "Bearer " + token}, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  return res.status;
});

export async function requireActiveProject(requested?: string, allowSharedOrder = false, returnTo?: string) {
  if (!loginEnabled) return parseProjectRouteId(requested);
  const suffix = returnTo ? "?callbackUrl=" + encodeURIComponent(returnTo) : "";
  if (!(await currentSession())?.user) redirect("/login" + suffix);
  const id = parseProjectRouteId(cookies().get(projectCookie)?.value);
  if (!id) redirect("/projects" + suffix);
  const status = await projectAccess(id);
  if (status === 401) redirect("/login" + suffix);
  if (status === 404 || status === 403) redirect("/projects?projectError=project-not-found");
  if (status !== 200) redirect("/projects?projectError=project-load-failed");
  if (requested !== undefined && parseProjectRouteId(requested) !== id) {
    const other = parseProjectRouteId(requested);
    if (allowSharedOrder && other) {
      const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(api + "/api/lab/projects", {
        headers: {Authorization: "Bearer " + (await currentSession())?.backendToken},
        cache: "no-store", signal: AbortSignal.timeout(10000),
      });
      if (response.ok && (await response.json()).some((p: {id:number; owner:boolean}) => p.id === other && p.owner === false)) return other;
    }
    redirect("/projects");
  }
  return id;
}
