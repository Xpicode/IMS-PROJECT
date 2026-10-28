/** Per-request context passed into services (for audit and logs). */
export type Ctx = { requestId: string; ip?: string | null };
