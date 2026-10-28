/**
 * Network calls from the field app: always time-limited (weak Wi-Fi can hang
 * for minutes) and they report whether the server answered, so the header can
 * say "Offline" when the server is unreachable even if the phone has signal.
 */
export const REACHABILITY_EVENT = "ims:reachability";

let lastReachable = true;
export const serverReachable = () => lastReachable;

function report(ok: boolean) {
  if (ok === lastReachable) return;
  lastReachable = ok;
  window.dispatchEvent(new CustomEvent(REACHABILITY_EVENT, { detail: ok }));
}

export async function fieldFetch(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    report(r.status < 500);
    return r;
  } catch (e) {
    report(false);
    throw e;
  }
}
