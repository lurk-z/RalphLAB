import { loginEnabled } from "./login-mode";

export async function selectLabProject(id: number) {
  if (!loginEnabled) return;
  const response = await fetch("/api/lab-selection", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id}),
  });
  if (response.status === 401) window.location.assign("/login");
  if (!response.ok) throw new Error("เปิดโปรเจกต์ไม่สำเร็จ กรุณาลองอีกครั้ง");
}
