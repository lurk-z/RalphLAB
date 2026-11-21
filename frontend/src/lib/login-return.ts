/** Resolve only app-local return paths from login links. */
export function loginReturnPath(value: string | string[] | undefined, fallback = "/projects") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  const base = "https://app.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith("//") || url.pathname === "/login") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
