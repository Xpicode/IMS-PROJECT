import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError, errorBody, errors } from "@/lib/api/errors";
import { getRequestUser } from "@/lib/auth/current-user";
import type { CurrentUser } from "@/lib/users/access";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import type { Ctx } from "@/lib/context";
import { Prisma } from "@/generated/prisma/client";

type Params = Record<string, string | string[] | undefined>;
type NextCtx = { params: Promise<Params> };

type Handler<A extends boolean> = (args: {
  req: Request;
  params: Params;
  ctx: Ctx;
  user: A extends true ? CurrentUser : CurrentUser | null;
}) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_JSON_BYTES = 1_000_000;

function requestOrigin(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return host.split(",")[0].trim().toLowerCase();
}

/**
 * Wraps every API Route Handler:
 * - request id (from NGINX `X-Request-Id` or new), echoed in `x-request-id`
 * - session check (`auth: true` -> 401 if signed out)
 * - CSRF defence: state-changing requests must come from our own origin
 * - error mapping to `{code, message, requestId}` (§12.3), never stack traces
 * - audit of denied access (§16)
 */
export function route<A extends boolean = true>(opts: { auth?: A }, handler: Handler<A>) {
  const needsAuth = opts.auth ?? true;
  return async (req: Request, next?: NextCtx): Promise<Response> => {
    const requestId = (req.headers.get("x-request-id") ?? "").slice(0, 64) || randomUUID();
    const ctx: Ctx = { requestId, ip: req.headers.get("x-real-ip") };
    let user: CurrentUser | null = null;
    try {
      if (!SAFE_METHODS.has(req.method)) {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host.toLowerCase() !== requestOrigin(req)) {
          throw new ApiError("BAD_ORIGIN", "This request came from another website and was blocked.");
        }
      }
      user = await getRequestUser(req);
      if (needsAuth && !user) throw errors.unauthenticated();
      const params = (await next?.params) ?? {};
      const res = await handler({ req, params, ctx, user: user as CurrentUser });
      res.headers.set("x-request-id", requestId);
      res.headers.set("cache-control", "no-store");
      return res;
    } catch (e) {
      const err = toApiError(e, requestId);
      if (err.status === 403) {
        await writeAudit(prisma, {
          actorId: user?.id ?? null,
          eventType: "auth.forbidden",
          after: { method: req.method, path: new URL(req.url).pathname, code: err.code },
          requestId,
        }).catch(() => undefined);
      }
      return Response.json(errorBody(err, requestId), {
        status: err.status,
        headers: { "x-request-id": requestId, "cache-control": "no-store" },
      });
    }
  };
}

function toApiError(e: unknown, requestId: string): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ApiError("DUPLICATE", "That value is already in use. Change it and try again.");
  }
  console.error(`[${requestId}]`, e);
  return new ApiError("INTERNAL", "Something went wrong on the server. Your work was not lost; try again in a moment.");
}

/** Read a JSON body with a size limit. */
export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_JSON_BYTES) throw new ApiError("VALIDATION_FAILED", "The request is too large.", { status: 413 });
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES)
    throw new ApiError("VALIDATION_FAILED", "The request is too large.", { status: 413 });
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_JSON", "The request body is not valid JSON.");
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** One path segment as a string, or 404 if it isn't a UUID (avoids DB errors on garbage ids). */
export function idParam(params: Params, key = "id", thing = "record"): string {
  const v = params[key];
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw errors.notFound(thing);
  }
  return v.toLowerCase();
}

/** Required Idempotency-Key header (UUID) for confirm endpoints (§12.4). */
export function idempotencyKey(req: Request): string {
  const k = req.headers.get("idempotency-key");
  if (!k || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
    throw new ApiError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "This action needs an Idempotency-Key header (a UUID). Refresh and try again.",
    );
  }
  return k.toLowerCase();
}
