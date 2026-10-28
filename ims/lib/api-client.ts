/**
 * Browser-side helper for /api/v1. Errors keep the server's plain-language
 * message and field errors so forms can show them next to the right field.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH"; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError("No connection to the server. Check your internet and try again.", 0, "NETWORK");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(
      data?.message ?? "Something went wrong. Try again.",
      res.status,
      data?.code ?? "UNKNOWN",
      data?.fields,
      data?.requestId,
    );
  }
  return data as T;
}

export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";
