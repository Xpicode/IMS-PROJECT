/**
 * One error shape for the whole API (§12.3):
 *   { "code": "INSUFFICIENT_STOCK", "message": "Only 3 left…", "requestId": "…" }
 * Messages are written for the person using the screen: what happened + what to do.
 * Never put stack traces, SQL, or internal paths in a message.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_INACTIVE"
  | "FORBIDDEN"
  | "BAD_ORIGIN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_JSON"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "COUNT_IN_PROGRESS"
  | "DUPLICATE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RATE_LIMITED"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ACCOUNT_INACTIVE: 401,
  FORBIDDEN: 403,
  BAD_ORIGIN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_JSON: 400,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  COUNT_IN_PROGRESS: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Field-level problems, keyed by field path (e.g. "lines.0.quantity"). */
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;

  constructor(code: ErrorCode, message: string, opts: { status?: number; fields?: FieldErrors } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.fields = opts.fields;
  }
}

export type ErrorBody = {
  code: ErrorCode;
  message: string;
  requestId: string;
  fields?: FieldErrors;
};

export function errorBody(err: ApiError, requestId: string): ErrorBody {
  return {
    code: err.code,
    message: err.message,
    requestId,
    ...(err.fields ? { fields: err.fields } : {}),
  };
}

// Common, reusable errors with plain-language messages.
export const errors = {
  unauthenticated: () => new ApiError("UNAUTHENTICATED", "You are signed out. Sign in again to continue."),
  inactive: () =>
    new ApiError("ACCOUNT_INACTIVE", "This account has been deactivated. Ask an administrator if you need access."),
  forbidden: (what = "do this") =>
    new ApiError("FORBIDDEN", `You don't have permission to ${what}. Ask a supervisor or administrator.`),
  notFound: (thing = "record") =>
    new ApiError("NOT_FOUND", `That ${thing} was not found. It may have been removed, or you may not have access.`),
};
