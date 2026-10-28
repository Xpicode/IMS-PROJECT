import { fieldFetch } from "./net";

/**
 * Who is using the field app. The user id/name/role (no secrets) is remembered
 * so the app can open the right local database while offline.
 */
export type FieldUser = { id: string; name: string; role: "ADMIN" | "SUPERVISOR" | "FIELD" };

const KEY = "ims-field-user";

export function storedUser(): FieldUser | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as FieldUser) : null;
  } catch {
    return null;
  }
}

export function rememberUser(u: FieldUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: u.id, name: u.name, role: u.role }));
  } catch {
    /* storage blocked: the app still works online */
  }
}

export function forgetUser() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export async function whoAmI(
  timeoutMs = 4000,
): Promise<{ state: "online"; user: FieldUser } | { state: "signed-out" } | { state: "offline" }> {
  try {
    const r = await fieldFetch("/api/v1/me", {}, timeoutMs);
    if (r.status === 401) return { state: "signed-out" };
    if (!r.ok) return { state: "offline" };
    const j = (await r.json()) as FieldUser;
    return { state: "online", user: { id: j.id, name: j.name, role: j.role } };
  } catch {
    return { state: "offline" };
  }
}
