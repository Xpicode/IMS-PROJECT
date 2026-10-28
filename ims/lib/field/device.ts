/** Storage and offline-readiness checks shown to the user (spec §10.5). Browser only. */
export type StorageStatus = {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
};

export async function storageStatus(): Promise<StorageStatus> {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!s) return { supported: false, persisted: null, usage: null, quota: null };
  const [persisted, est] = await Promise.all([
    s.persisted?.().catch(() => null) ?? null,
    s.estimate?.().catch(() => null) ?? null,
  ]);
  return { supported: true, persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}

/** Ask the browser not to clear our data under storage pressure. It may say no. */
export async function askPersist(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persist?.()) ?? null;
  } catch {
    return null;
  }
}

/** True when the service worker has the field app saved, so it opens without internet. */
export async function appCachedForOffline(): Promise<boolean> {
  try {
    if (!("caches" in window) || !navigator.serviceWorker?.controller) return false;
    return !!(await caches.match("/field", { ignoreSearch: true }));
  } catch {
    return false;
  }
}

export function formatBytes(n: number | null) {
  if (n === null) return "unknown";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
